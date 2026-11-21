import debug from "debug";
import mongoose from "mongoose";
import { escapeRegExp, isNumber, values } from "es-toolkit/compat";
import { NextFunction, Request, Response } from "express";
import { envConfig } from "../../env-config/env-config";
import { dateTimeNow } from "../../shared/dates";
import { member } from "../models/member";
import { notificationConfig } from "../models/notification-config";
import { memberEmailSend } from "../models/member-email-send";
import * as config from "./config";
import { memberBulkLoadDateMapValue } from "./member-bulk-load-audit";
import { audienceQuery, emailableGroupMemberQuery, filterSelectionQueries, sendBlockReasonQuery } from "./email-composer-audience-queries";
import { ConfigKey } from "../../../../projects/ngx-ramblers/src/app/models/config.model";
import { Member, MemberBulkLoadDateMap, MemberCookie } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { BULK_LOAD_MEMBER_SELECTIONS, MemberSelection, NotificationConfig } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import {
  COMPOSER_AUDIENCE_MAX_PAGE_SIZE,
  COMPOSER_MEMBER_FIELDS,
  COMPOSER_MEMBER_LOOKUP_LIMIT,
  COMPOSER_MEMBER_SEARCH_LIMIT,
  ComposerAudienceDefinition,
  ComposerAudiencePageRequest,
  ComposerAudienceSortField,
  ComposerFilterSelection,
  ComposerFilterSelectionRequest,
  ComposerListCount,
  ComposerMemberLookupRequest,
  ComposerMemberSearchResult,
  MemberSelectionWindow,
  MemberSendBlockReason,
  MemberSendRules,
  RecipientMode
} from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { audienceRow, memberSelectionWindow, priorSendExclusionApplies } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer-audience";
import { emailComposerAllowed } from "../../../../projects/ngx-ramblers/src/app/functions/member-send-eligibility";
import { memberDisambiguatedLabel, memberFullName } from "../../../../projects/ngx-ramblers/src/app/functions/member-names";

const debugLog: debug.Debugger = debug(envConfig.logNamespace("email-composer-audience"));

const NAME_FIELDS = {firstName: 1, lastName: 1, displayName: 1, nameAlias: 1, email: 1};
const NAME_SORT: Record<string, 1> = {firstName: 1, lastName: 1, _id: 1};

type MemberDocument = Member & {_id: unknown};

export function requireEmailComposer(req: Request, res: Response, next: NextFunction): void {
  if (emailComposerAllowed(req.user as MemberCookie)) {
    next();
  } else {
    res.status(403).json({error: "Email composer access required"});
  }
}

function withId(document: MemberDocument): Member {
  const {_id, ...fields} = document;
  return {...fields, id: String(_id)} as Member;
}

function validIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter(id => mongoose.isValidObjectId(id));
}

async function respond<T>(res: Response, label: string, work: () => Promise<T>): Promise<void> {
  try {
    const response = await work();
    res.setHeader("Cache-Control", "private, no-store");
    res.json({response});
  } catch (error) {
    debugLog(`${label} failed:`, error);
    res.status(500).json({error: error.message});
  }
}

async function notificationFor(notificationConfigId: string | null | undefined): Promise<NotificationConfig | null> {
  return notificationConfigId && mongoose.isValidObjectId(notificationConfigId)
    ? notificationConfig.findById(notificationConfigId).lean<NotificationConfig>().exec()
    : null;
}

async function sendRules(request: {narrowListId?: number | null; recipientMode: RecipientMode}, notification: NotificationConfig | null): Promise<MemberSendRules> {
  const brevoConfig = (await config.queryKey(ConfigKey.BREVO))?.value;
  const referenceListId = isNumber(request.narrowListId) ? request.narrowListId : isNumber(notification?.defaultListId) ? notification.defaultListId : null;
  return {
    respectEmailBlocks: brevoConfig?.respectEmailBlocks === true,
    respectHeadOfficeConsent: request.recipientMode === RecipientMode.SELECTED_MEMBERS && brevoConfig?.respectHeadOfficeConsent !== false,
    referenceListId
  };
}

function selectionWindow(notification: NotificationConfig | null): MemberSelectionWindow {
  return memberSelectionWindow(dateTimeNow().startOf("day"), notification?.monthsInPast, notification?.timeUnit);
}

async function bulkLoadDateMapFor(preFilterKey: MemberSelection | null | undefined): Promise<MemberBulkLoadDateMap | null> {
  return BULK_LOAD_MEMBER_SELECTIONS.includes(preFilterKey) ? memberBulkLoadDateMapValue() : null;
}

async function memberIdsMatching(query: object): Promise<string[]> {
  const documents = await member.find(query, {_id: 1}).sort(NAME_SORT).lean<{_id: unknown}[]>().exec();
  return documents.map(document => String(document._id));
}

async function audienceContext(definition: ComposerAudienceDefinition): Promise<{query: object; rules: MemberSendRules}> {
  const notification = await notificationFor(definition.notificationConfigId);
  const [bulkLoadDateMap, rules] = await Promise.all([bulkLoadDateMapFor(definition.preFilterKey), sendRules(definition, notification)]);
  return {query: audienceQuery(definition, selectionWindow(notification), bulkLoadDateMap), rules};
}

export async function summary(req: Request, res: Response): Promise<void> {
  await respond(res, "summary", async () => {
    const {query, rules} = await audienceContext(req.body.definition as ComposerAudienceDefinition);
    const [total, ...reasonCounts] = await Promise.all([
      member.countDocuments(query).exec(),
      ...values(MemberSendBlockReason).map(reason => member.countDocuments({$and: [query, sendBlockReasonQuery(reason, rules)]}).exec())
    ]);
    const unavailable = values(MemberSendBlockReason)
      .map((reason, index) => ({reason, count: reasonCounts[index]}))
      .filter(item => item.count > 0);
    return {total, sendable: total - unavailable.reduce((sum, item) => sum + item.count, 0), unavailable};
  });
}

function searchQuery(search: string | undefined): object {
  const words = (search ?? "").trim().split(/\s+/).filter(word => !!word);
  return words.length === 0 ? {} : {$and: words.map(word => {
    const pattern = new RegExp(escapeRegExp(word), "i");
    return {$or: [{firstName: pattern}, {lastName: pattern}, {displayName: pattern}, {email: pattern}]};
  })};
}

export async function page(req: Request, res: Response): Promise<void> {
  await respond(res, "page", async () => {
    const request = req.body as ComposerAudiencePageRequest;
    const {query, rules} = await audienceContext(request.definition);
    const pageSize = Math.min(Math.max(1, request.pageSize || COMPOSER_AUDIENCE_MAX_PAGE_SIZE), COMPOSER_AUDIENCE_MAX_PAGE_SIZE);
    const pageNumber = Math.max(1, request.page || 1);
    const direction = request.sortDescending ? -1 : 1;
    const sort = request.sortField === ComposerAudienceSortField.EMAIL ? {email: direction, _id: 1} : {firstName: direction, lastName: direction, _id: 1};
    const pageQuery = {$and: [query, searchQuery(request.search)]};
    const [total, documents] = await Promise.all([
      member.countDocuments(pageQuery).exec(),
      member.find(pageQuery, COMPOSER_MEMBER_FIELDS).sort(sort as Record<string, 1 | -1>).skip((pageNumber - 1) * pageSize).limit(pageSize).lean<MemberDocument[]>().exec()
    ]);
    return {rows: documents.map(withId).map(item => audienceRow(item, rules)), total, page: pageNumber, pageSize};
  });
}

export async function memberIdsForAudience(definition: ComposerAudienceDefinition): Promise<string[]> {
  const {query} = await audienceContext(definition);
  return memberIdsMatching(query);
}

export async function audienceMemberIds(req: Request, res: Response): Promise<void> {
  await respond(res, "audienceMemberIds", async () => {
    return memberIdsForAudience(req.body.definition as ComposerAudienceDefinition);
  });
}

export async function membersByReference(req: Request, res: Response): Promise<void> {
  await respond(res, "membersByReference", async () => {
    const request = req.body as ComposerMemberLookupRequest;
    const ids = validIds(request.memberIds);
    const emails = (request.emails ?? []).map(email => (email || "").trim()).filter(email => !!email);
    const criteria = [
      ...(ids.length ? [{_id: {$in: ids}}] : []),
      ...(emails.length ? [{email: {$in: emails.map(email => new RegExp(`^${escapeRegExp(email)}$`, "i"))}}] : []),
      ...(request.committee ? [{committee: true}] : [])
    ];
    const documents = criteria.length === 0
      ? []
      : await member.find({$or: criteria}, COMPOSER_MEMBER_FIELDS).sort(NAME_SORT).limit(COMPOSER_MEMBER_LOOKUP_LIMIT).lean<MemberDocument[]>().exec();
    return documents.map(withId);
  });
}

async function priorSendDates(notificationConfigId: string | null | undefined): Promise<Map<string, number>> {
  const sends = notificationConfigId
    ? await memberEmailSend.aggregate<{_id: string; sentAt: number}>([
      {$match: {notificationConfigId}},
      {$group: {_id: "$memberId", sentAt: {$max: "$sentAt"}}}
    ])
    : [];
  return new Map(sends.map(send => [send._id, send.sentAt]));
}

export async function filterSelection(req: Request, res: Response): Promise<void> {
  await respond(res, "filterSelection", async (): Promise<ComposerFilterSelection> => {
    const request = req.body as ComposerFilterSelectionRequest;
    const notification = await notificationFor(request.notificationConfigId);
    const exclusionApplies = priorSendExclusionApplies(notification, request.preFilterKey ?? null);
    const [bulkLoadDateMap, rules, sentDates] = await Promise.all([
      bulkLoadDateMapFor(request.preFilterKey),
      sendRules(request, notification),
      exclusionApplies ? priorSendDates(request.notificationConfigId) : Promise.resolve(new Map<string, number>())
    ]);
    const {candidates, available, matching} = filterSelectionQueries(request, notification, rules, selectionWindow(notification), bulkLoadDateMap);
    const sentIds = validIds([...sentDates.keys()]);
    const keepIds = validIds(request.keepMemberIds);
    const [candidateCount, memberIds, alreadySent, keptMemberIds] = await Promise.all([
      member.countDocuments(candidates).exec(),
      memberIdsMatching(matching),
      sentIds.length ? member.find({$and: [matching, {_id: {$in: sentIds}}]}, NAME_FIELDS).lean<MemberDocument[]>().exec() : Promise.resolve([] as MemberDocument[]),
      keepIds.length ? memberIdsMatching({$and: [available, {_id: {$in: keepIds}}]}) : Promise.resolve([] as string[])
    ]);
    const priorSendExclusions = alreadySent.map(withId)
      .map(item => ({memberId: item.id, name: memberDisambiguatedLabel(item), sentAt: sentDates.get(item.id) ?? 0}))
      .filter(exclusion => exclusion.sentAt > 0)
      .sort((first, second) => second.sentAt - first.sentAt);
    const excluded = new Set(priorSendExclusions.map(exclusion => exclusion.memberId));
    const kept = new Set(keptMemberIds);
    return {
      candidateCount,
      memberIds: request.includeAlreadySent ? memberIds : memberIds.filter(id => !excluded.has(id)),
      keptMemberIds: keepIds.filter(id => kept.has(id)),
      priorSendExclusions
    };
  });
}

export async function memberSearch(req: Request, res: Response): Promise<void> {
  await respond(res, "memberSearch", async (): Promise<ComposerMemberSearchResult[]> => {
    const query = String(req.query.search ?? "").trim();
    const pattern = new RegExp(escapeRegExp(query), "i");
    const matches = query
      ? await member.find({$and: [emailableGroupMemberQuery(), {$or: [{firstName: pattern}, {lastName: pattern}, {displayName: pattern}, {email: pattern}]}]},
        {firstName: 1, lastName: 1, displayName: 1, email: 1}).sort({firstName: 1, lastName: 1}).limit(COMPOSER_MEMBER_SEARCH_LIMIT).lean<MemberDocument[]>().exec()
      : [];
    return matches.map(withId).map(match => ({memberId: match.id, name: memberFullName(match), email: match.email}));
  });
}

export async function listCounts(req: Request, res: Response): Promise<void> {
  await respond(res, "listCounts", async (): Promise<ComposerListCount[]> => {
    const listIds = String(req.query.listIds ?? "").split(",").map(value => Number(value)).filter(value => Number.isInteger(value));
    const counted = listIds.length === 0 ? [] : await member.aggregate<{_id: number; count: number; committee: number}>([
      {$match: emailableGroupMemberQuery()},
      {$unwind: "$mail.subscriptions"},
      {$match: {"mail.subscriptions.subscribed": true, "mail.subscriptions.id": {$in: listIds}}},
      {$group: {_id: {listId: "$mail.subscriptions.id", memberId: "$_id"}, committee: {$first: "$committee"}}},
      {$group: {_id: "$_id.listId", count: {$sum: 1}, committee: {$sum: {$cond: ["$committee", 1, 0]}}}}
    ]);
    return listIds.map(listId => {
      const found = counted.find(item => item._id === listId);
      const subscriberCount = found?.count ?? 0;
      return {listId, subscriberCount, committeeOnly: subscriberCount > 0 && found?.committee === subscriberCount};
    });
  });
}
