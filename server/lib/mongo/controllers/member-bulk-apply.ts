import debug from "debug";
import { Request, Response } from "express";
import { chunk, isArray, omit } from "es-toolkit/compat";
import mongoose from "mongoose";
import { envConfig } from "../../env-config/env-config";
import { dateTimeNowAsValue } from "../../shared/dates";
import { systemConfig as loadSystemConfig } from "../../config/system-config";
import { brevoClient, configuredBrevo } from "../../brevo/brevo-config";
import { fetchExistingListIds } from "../../brevo/lists/existing-list-ids";
import { member } from "../models/member";
import { memberBulkLoadAudit } from "../models/member-bulk-load-audit";
import { memberUpdateAudit } from "../models/member-update-audit";
import * as config from "./config";
import { auditSubscriptionChanges } from "./member-subscription-audit";
import { reconcileMemberSyncNotifications } from "./member-sync-notification";
import { writeBackFullOptOuts } from "../../salesforce/member-consent-writeback";
import { rematchWalkLeadersAfterMemberChange } from "../../walks/walk-leader-rematch";
import { ConfigKey } from "../../../../projects/ngx-ramblers/src/app/models/config.model";
import { MailConfig, MailSubscription } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import {
  MemberApplyContext,
  MemberApplyMailContext,
  MemberApplyOutcome,
  MemberBulkApplyRequest,
  MemberBulkApplyResult,
  MemberPlannedWrite
} from "../../../../projects/ngx-ramblers/src/app/models/member-bulk-apply.model";
import { Member, MemberAction, MemberBulkLoadAudit, MemberUpdateAudit, RamblersMember } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { DEFAULT_MEMBER_SYNC_POLICY, MemberSyncPolicy } from "../../../../projects/ngx-ramblers/src/app/models/member-sync-policy.model";
import { MailProvider } from "../../../../projects/ngx-ramblers/src/app/models/system.model";
import { applyRamblersMember } from "../../../../projects/ngx-ramblers/src/app/functions/member-bulk-apply";
import { memberApplyDates } from "../../../../projects/ngx-ramblers/src/app/functions/member-apply-dates";
import { mailContextFromParts } from "../../../../projects/ngx-ramblers/src/app/functions/mail-subscription-defaults";

const debugLog = debug(envConfig.logNamespace("member-bulk-apply"));
debugLog.enabled = true;

const APPLY_BATCH_SIZE = 200;
const WRITE_BATCH_SIZE = 500;
const STALE_APPLY_CLAIM_MS = 30 * 60 * 1000;

const activeApply: {uploadSessionId: string | null} = {uploadSessionId: null};

function applyError(message: string, status: number): Error {
  return Object.assign(new Error(message), {status});
}

function actingUser(req: Request): string {
  return (req as any).user?.memberId ?? "system";
}

function toMember(document: any): Member {
  return {...omit(document, ["_id", "__v"]), id: document._id.toString()} as Member;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function syncPolicy(): Promise<MemberSyncPolicy> {
  const document = await config.queryKey(ConfigKey.MEMBER_SYNC_POLICY);
  const value = document?.value as MemberSyncPolicy;
  return {defaultMode: value?.defaultMode ?? DEFAULT_MEMBER_SYNC_POLICY.defaultMode, overrides: {...(value?.overrides ?? {})}};
}

async function brevoListIds(mailConfig: MailConfig): Promise<number[]> {
  try {
    return Array.from(await fetchExistingListIds(await brevoClient(mailConfig)));
  } catch (error) {
    debugLog("brevoListIds: Brevo lists could not be read, using configured list settings:", error);
    return (mailConfig?.listSettings ?? []).map(setting => setting.id);
  }
}

export async function serverMailContext(): Promise<MemberApplyMailContext> {
  const systemConfig = await loadSystemConfig();
  const mailConfig = await configuredBrevo().catch(() => null as MailConfig);
  const listIds = systemConfig?.mailDefaults?.mailProvider === MailProvider.BREVO && mailConfig ? await brevoListIds(mailConfig) : [];
  return mailContextFromParts(mailConfig, listIds, systemConfig);
}

async function applyAll(context: MemberApplyContext, ramblersMembers: RamblersMember[], existingMembers: Member[]): Promise<MemberApplyOutcome[]> {
  return chunk(ramblersMembers, APPLY_BATCH_SIZE).reduce(async (previous: Promise<MemberApplyOutcome[]>, batch: RamblersMember[]) => {
    const outcomes = await previous;
    await yieldToEventLoop();
    return outcomes.concat(batch.map(ramblersMember => applyRamblersMember(context, ramblersMember, existingMembers)));
  }, Promise.resolve([] as MemberApplyOutcome[]));
}

export function needsWrite(outcome: MemberApplyOutcome, mailProvider: MailProvider): boolean {
  return outcome.memberAction !== MemberAction.skipped || mailProvider === MailProvider.MAILCHIMP;
}

export function writeOperation(write: MemberPlannedWrite, now: number, updatedBy: string): any {
  const document = omit(write.outcome.member, ["id", "_id"]);
  return write.created
    ? {insertOne: {document: {...document, _id: new mongoose.Types.ObjectId(write.memberId), createdDate: now, createdBy: updatedBy}}}
    : {updateOne: {filter: {_id: write.memberId}, update: {$set: {...document, updatedDate: now, updatedBy}}}};
}

function failureText(failure: any): string {
  return failure?.errmsg || failure?.err?.errmsg || failure?.message || String(failure);
}

export function bulkWriteFailures(operationCount: number, result: any, error: any): (string | null)[] {
  const perOperation: any[] = result?.mongoose?.results ?? error?.mongoose?.results;
  const writeErrors: any[] = error?.writeErrors ?? [];
  const failures = isArray(perOperation)
    ? Array.from({length: operationCount}, (_, index) => perOperation[index] ? failureText(perOperation[index]) : null)
    : Array.from({length: operationCount}, (_, index) => {
      const writeError = writeErrors.find(candidate => (candidate?.index ?? candidate?.err?.index) === index);
      return writeError ? failureText(writeError) : null;
    });
  if (error && !failures.some(failure => !!failure)) {
    throw error;
  }
  return failures;
}

async function writeMembers(writes: MemberPlannedWrite[], now: number, updatedBy: string): Promise<Map<number, string>> {
  return chunk(writes, WRITE_BATCH_SIZE).reduce(async (previous: Promise<Map<number, string>>, batch: MemberPlannedWrite[]) => {
    const failures = await previous;
    const settled = await member.bulkWrite(batch.map(write => writeOperation(write, now, updatedBy)), {ordered: false})
      .then(result => ({result, error: null}))
      .catch(error => ({result: null, error}));
    bulkWriteFailures(batch.length, settled.result, settled.error)
      .forEach((failure, position) => failure ? failures.set(batch[position].index, failure) : null);
    return failures;
  }, Promise.resolve(new Map<number, string>()));
}

export function auditFor(uploadSessionId: string, outcome: MemberApplyOutcome, index: number, memberId: string | null, failure: string | undefined, created: boolean, now: number, updatedBy: string): MemberUpdateAudit {
  const audit: MemberUpdateAudit = {
    uploadSessionId,
    updateTime: now,
    memberMatch: outcome.memberMatch,
    memberAction: failure ? MemberAction.error : outcome.memberAction,
    rowNumber: index + 1,
    changes: outcome.changes,
    fieldChanges: outcome.fieldChanges,
    memberId: failure && created ? null : memberId,
    updatedBy,
    updatedDate: now
  };
  return failure
    ? {...audit, member: outcome.member, auditErrorMessage: {message: created ? "Creation of member failed" : "Update of member failed", error: failure}}
    : audit;
}

async function claimUploadSession(uploadSessionId: string): Promise<MemberBulkLoadAudit> {
  const now = dateTimeNowAsValue();
  const claimed = await memberBulkLoadAudit.findOneAndUpdate(
    {_id: uploadSessionId, appliedAt: {$exists: false}, $or: [{applyStartedAt: {$exists: false}}, {applyStartedAt: {$lt: now - STALE_APPLY_CLAIM_MS}}]},
    {$set: {applyStartedAt: now}},
    {new: true}
  ).lean().exec() as unknown as MemberBulkLoadAudit;
  const exists = claimed ? true : !!(await memberBulkLoadAudit.exists({_id: uploadSessionId}));
  if (claimed) {
    return claimed;
  } else if (exists) {
    throw applyError(`Upload session ${uploadSessionId} has already been applied or is being applied`, 409);
  } else {
    throw applyError(`Upload session ${uploadSessionId} was not found`, 404);
  }
}

async function applyClaimedSession(request: MemberBulkApplyRequest, bulkLoad: MemberBulkLoadAudit, updatedBy: string): Promise<MemberBulkApplyResult> {
  const startedAt = dateTimeNowAsValue();
  const ramblersMembers: RamblersMember[] = bulkLoad.members ?? [];
  const existingMembers: Member[] = (await member.find({}).lean().exec()).map(toMember);
  const priorSubscriptionsById = new Map<string, MailSubscription[]>(existingMembers.map(existing => [existing.id, JSON.parse(JSON.stringify(existing.mail?.subscriptions ?? []))]));
  const context: MemberApplyContext = {dates: memberApplyDates(), syncPolicy: await syncPolicy(), mail: await serverMailContext()};
  debugLog("applyMemberBulkLoad:", ramblersMembers.length, "records against", existingMembers.length, "members for session", request.uploadSessionId);

  const outcomes = await applyAll(context, ramblersMembers, existingMembers);
  const writes: MemberPlannedWrite[] = outcomes
    .map((outcome, index) => ({outcome, index}))
    .filter(({outcome}) => needsWrite(outcome, context.mail.mailProvider))
    .map(({outcome, index}) => {
      const created = outcome.memberMatch === MemberAction.created;
      return {index, outcome, created, memberId: created ? new mongoose.Types.ObjectId().toString() : outcome.member.id};
    });
  const now = dateTimeNowAsValue();
  const failures = await writeMembers(writes, now, updatedBy);
  const writesByIndex = new Map(writes.map(write => [write.index, write]));
  const audits = outcomes.map((outcome, index) => {
    const write = writesByIndex.get(index);
    return auditFor(request.uploadSessionId, outcome, index, write?.memberId ?? outcome.member.id ?? null, failures.get(index), !!write?.created, now, updatedBy);
  });
  await Promise.all(chunk(audits, WRITE_BATCH_SIZE).map(batch => memberUpdateAudit.insertMany(batch, {ordered: false})));

  const saved: Member[] = writes
    .filter(write => !failures.has(write.index))
    .map(write => ({...write.outcome.member, id: write.memberId}));
  await auditSubscriptionChanges(saved.map(savedMember => ({
    memberId: savedMember.id,
    prior: priorSubscriptionsById.get(savedMember.id),
    next: savedMember.mail?.subscriptions
  })), updatedBy);
  await writeBackFullOptOuts(saved.filter(savedMember => priorSubscriptionsById.has(savedMember.id)), priorSubscriptionsById, updatedBy);
  await reconcileMemberSyncNotifications({
    syncRunAt: now,
    candidates: outcomes.flatMap(outcome => outcome.notificationCandidates),
    processedMemberIds: outcomes.filter(outcome => outcome.memberMatch === MemberAction.found && !!outcome.member.id).map(outcome => outcome.member.id)
  });
  rematchWalkLeadersAfterMemberChange("member-bulk-load-complete", request.uploadSessionId)
    .catch(error => debugLog("applyMemberBulkLoad:walk leader rematch failed:", error));

  const result: MemberBulkApplyResult = {
    uploadSessionId: request.uploadSessionId,
    total: outcomes.length,
    created: writes.filter(write => write.created && !failures.has(write.index)).length,
    updated: outcomes.filter((outcome, index) => outcome.memberAction === MemberAction.updated && !failures.has(index)).length,
    skipped: outcomes.filter(outcome => outcome.memberAction === MemberAction.skipped).length,
    failed: failures.size,
    durationMs: dateTimeNowAsValue() - startedAt
  };
  debugLog("applyMemberBulkLoad:result", result);
  return result;
}

export async function applyMemberBulkLoad(request: MemberBulkApplyRequest, updatedBy: string): Promise<MemberBulkApplyResult> {
  if (activeApply.uploadSessionId) {
    throw applyError(`Another member load (${activeApply.uploadSessionId}) is being applied; try again when it has finished`, 409);
  } else {
    activeApply.uploadSessionId = request.uploadSessionId;
    try {
      const bulkLoad = await claimUploadSession(request.uploadSessionId);
      const result = await applyClaimedSession(request, bulkLoad, updatedBy)
        .catch(async error => {
          await memberBulkLoadAudit.updateOne({_id: request.uploadSessionId}, {$unset: {applyStartedAt: ""}}).exec();
          throw error;
        });
      await memberBulkLoadAudit.updateOne({_id: request.uploadSessionId}, {$set: {appliedAt: dateTimeNowAsValue()}}).exec();
      return result;
    } finally {
      activeApply.uploadSessionId = null;
    }
  }
}

export async function apply(req: Request, res: Response): Promise<void> {
  try {
    const result = await applyMemberBulkLoad({uploadSessionId: req.params.id}, actingUser(req));
    res.status(200).json({response: result});
  } catch (error: any) {
    debugLog("apply:error", error);
    res.status(error?.status || 500).json({message: "Member bulk load could not be applied", error: error?.message ?? String(error)});
  }
}
