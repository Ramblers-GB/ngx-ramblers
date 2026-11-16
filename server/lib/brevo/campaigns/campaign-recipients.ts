import {values} from "es-toolkit/compat";
import { createHash } from "crypto";
import {CachedRecipientRows, MemberRecipientInfo, RecipientExportScope, RecipientRow, RecipientSelector} from "./campaign-recipient-export.model";
import debug from "debug";
import { Request, Response } from "express";
import { BrevoClient } from "@getbrevo/brevo";
import { handleError, successfulResponse } from "../common/messages";
import { envConfig } from "../../env-config/env-config";
import { brevoClient, configuredBrevo } from "../brevo-config";
import { scheduleBrevo } from "../common/rate-limiting";
import { member } from "../../mongo/models/member";
import { campaignRecipientExport } from "../../mongo/models/campaign-recipient-export";
import { CAMPAIGN_RECIPIENT_EXPORT_UNAVAILABLE, CampaignRecipient, CampaignRecipientExportErrorCode, CampaignRecipientsReport, CampaignRecipientType, MailConfig } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { dateTimeNow } from "../../shared/dates";
import { parseRecipientExportCsv } from "./campaign-recipient-export";
import { HttpError } from "../../shared/http-error";

const messageType = "brevo:campaign-recipients";
const debugLog = debug(envConfig.logNamespace(messageType));

const MAX_RECIPIENTS = 2000;
const POLL_ATTEMPTS = 80;
const POLL_INTERVAL_MS = 1500;
const QUEUED_POLLS_BEFORE_RETRY = 8;
const CACHE_TTL_MS = 30 * 60 * 1000;

const cardTypeSelectors: Record<CampaignRecipientType, RecipientSelector> = {
  [CampaignRecipientType.DELIVERED]: {select: row => !!row.deliveredDate && !row.hardBounceDate && !row.softBounceDate, date: row => row.deliveredDate},
  [CampaignRecipientType.OPENED]: {select: row => !!row.openDate, date: row => row.openDate},
  [CampaignRecipientType.CLICKS]: {select: row => row.clickedCount > 0, date: row => row.deliveredDate, links: row => row.clickedLinks},
  [CampaignRecipientType.UNSUBSCRIBED]: {select: row => !!row.unsubscribeDate, date: row => row.unsubscribeDate},
  [CampaignRecipientType.HARD_BOUNCES]: {select: row => !!row.hardBounceDate, date: row => row.hardBounceDate},
  [CampaignRecipientType.SOFT_BOUNCES]: {select: row => !!row.softBounceDate, date: row => row.softBounceDate}
};

const rowsCache = new Map<string, CachedRecipientRows>();
const exportJobs = new Map<string, Promise<RecipientRow[]>>();
const MAX_CACHED_CAMPAIGNS = 3;

export function brevoAccountKey(apiKey: string): string {
  return createHash("sha256").update(apiKey || "").digest("hex").slice(0, 16);
}

function scopeKey(scope: RecipientExportScope): string {
  return `${scope.accountKey}:${scope.campaignId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exportUrlForProcess(client: BrevoClient, processId: number, attemptsRemaining: number, queuedPolls: number, previousStatus: string): Promise<string | null> {
  debugLog("getProcess request", JSON.stringify({processId}));
  const process = await scheduleBrevo(() => client.process.getProcess({processId}));
  const status = process.status || "";
  if (queuedPolls === 1 || status !== previousStatus || process.export_url) {
    debugLog("getProcess response", JSON.stringify(process), "attempts left", attemptsRemaining);
  } else {
    debugLog("export process", processId, "status", status, "attempts left", attemptsRemaining);
  }
  if (process.export_url) {
    return process.export_url;
  } else if (status === "failed" || status === "cancelled") {
    throw new HttpError(502, `Brevo recipient export ${status}`);
  } else if (status === "queued" && queuedPolls >= QUEUED_POLLS_BEFORE_RETRY) {
    debugLog("export process", processId, "still queued after", queuedPolls, "checks; starting another export");
    return null;
  } else if (attemptsRemaining <= 0) {
    throw new HttpError(502, "Brevo recipient export did not finish. Try View again.");
  } else {
    await delay(POLL_INTERVAL_MS);
    const nextQueuedPolls = status === "queued" ? queuedPolls + 1 : 0;
    return exportUrlForProcess(client, processId, attemptsRemaining - 1, nextQueuedPolls, status);
  }
}

function processIdFrom(exportResponse: {processId?: number; process_id?: number} | null | undefined): number | null {
  const processId = exportResponse?.processId ?? exportResponse?.process_id;
  return processId ? processId : null;
}

function exportUrlMatchesCampaign(exportUrl: string, campaignId: number): boolean {
  return [`campaign-[${campaignId}]`, `campaign-%5B${campaignId}%5D`].some(marker => exportUrl.includes(marker));
}

async function completedExportUrl(client: BrevoClient, campaignId: number): Promise<string | null> {
  const listed = await scheduleBrevo(() => client.process.getProcesses({limit: 50, sort: "desc"}));
  const match = (listed.processes || []).find(process => process.status === "completed" && process.export_url && exportUrlMatchesCampaign(process.export_url, campaignId));
  if (match?.export_url) {
    debugLog("reusing completed export process", match.id, "for campaign", campaignId);
    return match.export_url;
  } else {
    return null;
  }
}

async function exportDownloadUrl(client: BrevoClient, campaignId: number): Promise<string | null> {
  const exportRequest = {campaignId, recipientsType: "all" as const};
  debugLog("emailExportRecipients request", JSON.stringify(exportRequest));
  const exportResponse = await scheduleBrevo(() => client.emailCampaigns.emailExportRecipients(exportRequest));
  debugLog("emailExportRecipients response", JSON.stringify(exportResponse));
  const processId = processIdFrom(exportResponse);
  if (processId) {
    debugLog("started export process", processId, "for campaign", campaignId);
    return exportUrlForProcess(client, processId, POLL_ATTEMPTS, 1, "");
  } else {
    debugLog("Brevo returned no processId for campaign", campaignId, "- looking for a completed export");
    return completedExportUrl(client, campaignId);
  }
}

async function csvFromExportUrl(exportUrl: string, apiKey: string): Promise<string> {
  const first = await fetch(exportUrl);
  if (first.ok) {
    return first.text();
  } else {
    const second = await fetch(exportUrl, {headers: {"api-key": apiKey}});
    if (second.ok) {
      return second.text();
    } else {
      throw new HttpError(502, "Brevo recipient export could not be downloaded. Try View again.");
    }
  }
}

async function persistRows(scope: RecipientExportScope, rows: RecipientRow[]): Promise<RecipientRow[]> {
  await campaignRecipientExport.findOneAndUpdate(
    scope,
    {rows, cachedAt: dateTimeNow().toMillis()},
    {upsert: true}
  );
  return storeRows(scope, rows);
}

async function persistedRows(scope: RecipientExportScope): Promise<RecipientRow[] | null> {
  const record = await campaignRecipientExport.findOne(scope).lean().exec();
  if (record?.rows?.length) {
    debugLog("serving campaign", scope.campaignId, "recipients from saved export", record.rows.length, "rows");
    return storeRows(scope, record.rows);
  } else {
    return null;
  }
}

async function downloadedRows(exportUrl: string, apiKey: string): Promise<RecipientRow[] | null> {
  try {
    return parseRecipientExportCsv(await csvFromExportUrl(exportUrl, apiKey));
  } catch (error) {
    debugLog("recipient export download failed:", error);
    return null;
  }
}

async function memberInfoByEmail(emails: string[]): Promise<Map<string, MemberRecipientInfo>> {
  const loweredEmails = [...new Set(emails.map(email => email.toLowerCase()))];
  const members = await member.find(
    {email: {$in: loweredEmails}},
    {email: 1, firstName: 1, lastName: 1, displayName: 1, membershipNumber: 1}
  ).lean().exec() as any[];
  return members.reduce((map, memberRecord) => {
    if (memberRecord.email) {
      const fullName = [memberRecord.firstName, memberRecord.lastName].filter(Boolean).join(" ").trim() || memberRecord.displayName || "";
      map.set(memberRecord.email.toLowerCase(), {
        name: fullName || undefined,
        membershipNumber: memberRecord.membershipNumber || undefined
      });
    }
    return map;
  }, new Map<string, MemberRecipientInfo>());
}

function storeRows(scope: RecipientExportScope, rows: RecipientRow[]): RecipientRow[] {
  const key = scopeKey(scope);
  rowsCache.delete(key);
  if (rows.length > 0) {
    rowsCache.set(key, {rows, cachedAt: dateTimeNow().toMillis()});
    Array.from(rowsCache.keys())
      .slice(0, Math.max(0, rowsCache.size - MAX_CACHED_CAMPAIGNS))
      .forEach(evictableKey => rowsCache.delete(evictableKey));
  }
  return rows;
}

async function runExport(scope: RecipientExportScope, configuration: MailConfig): Promise<RecipientRow[]> {
  const client = await brevoClient(configuration);
  const firstUrl = await exportDownloadUrl(client, scope.campaignId);
  const exportUrl = firstUrl ? firstUrl : await exportDownloadUrl(client, scope.campaignId);
  const downloaded = exportUrl ? await downloadedRows(exportUrl, configuration.apiKey) : null;
  if (downloaded?.length) {
    return persistRows(scope, downloaded);
  } else {
    const saved = await persistedRows(scope);
    if (saved) {
      return saved;
    } else if (downloaded) {
      return storeRows(scope, downloaded);
    } else if (exportUrl) {
      throw new HttpError(502, "Brevo recipient export could not be downloaded. Try View again.");
    } else {
      throw new HttpError(502, CAMPAIGN_RECIPIENT_EXPORT_UNAVAILABLE, CampaignRecipientExportErrorCode.UNAVAILABLE);
    }
  }
}

export async function campaignRecipientRows(campaignId: number): Promise<RecipientRow[]> {
  const configuration = await configuredBrevo();
  const scope = {accountKey: brevoAccountKey(configuration.apiKey), campaignId};
  const key = scopeKey(scope);
  const cached = rowsCache.get(key);
  if (cached && cached.rows.length > 0 && dateTimeNow().toMillis() - cached.cachedAt < CACHE_TTL_MS) {
    debugLog(`Serving campaign ${campaignId} recipients from cache (${cached.rows.length} rows); no Brevo export triggered`);
    return cached.rows;
  } else {
    const existing = exportJobs.get(key);
    if (existing) {
      return existing;
    } else {
      const job = runExport(scope, configuration).finally(() => {
        exportJobs.delete(key);
      });
      exportJobs.set(key, job);
      return job;
    }
  }
}

export function recipientSelectorFor(type: string): RecipientSelector {
  if (!values(CampaignRecipientType).includes(type as CampaignRecipientType)) {
    throw new HttpError(400, "Unsupported recipient type");
  } else {
    return cardTypeSelectors[type as CampaignRecipientType];
  }
}

export async function recipientsReportFor(campaignId: number, type: string): Promise<CampaignRecipientsReport> {
  const selector = recipientSelectorFor(type);
  const rows = await campaignRecipientRows(campaignId);
  const matched = rows.filter(selector.select);
  const sliced = matched.slice(0, MAX_RECIPIENTS);
  const memberInfo = await memberInfoByEmail(sliced.map(row => row.email));
  const recipients: CampaignRecipient[] = sliced.map(row => {
    const info = memberInfo.get(row.email.toLowerCase());
    return {
      email: row.email,
      date: selector.date(row),
      name: info?.name,
      membershipNumber: info?.membershipNumber,
      links: selector.links ? selector.links(row) : undefined
    };
  });
  return {recipients, truncated: matched.length > MAX_RECIPIENTS};
}

export async function campaignRecipients(req: Request, res: Response): Promise<void> {
  try {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      res.status(400).json({error: "campaignId is required"});
    } else {
      const body = await recipientsReportFor(campaignId, String(req.query.type));
      successfulResponse({req, res, response: body, messageType, debugLog});
    }
  } catch (error) {
    handleError(req, res, messageType, debugLog, error);
  }
}
