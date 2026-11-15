import debug from "debug";
import { Request, Response } from "express";
import { isString } from "es-toolkit/compat";
import { Brevo } from "@getbrevo/brevo";
import { handleError, successfulResponse } from "../common/messages";
import { envConfig } from "../../env-config/env-config";
import { brevoClient } from "../brevo-config";
import { scheduleBrevo } from "../common/rate-limiting";
import { clampDateRange } from "../common/date-range";
import {
  BrevoEventType,
  BrevoTransactionalEmailListResponse,
  BrevoTransactionalEmailSummary
} from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { enrichTransactionalEmailOrigins } from "./enrich-transactional-origins";
import { normaliseEmail } from "../../../../projects/ngx-ramblers/src/app/functions/strings";
import {
  attachDiagnosticsToTransactionalSummaries,
  mergeDiagnosticOnlyTransactionalBounces,
  providerEventToBrevoEventType
} from "../../../../projects/ngx-ramblers/src/app/functions/brevo-bounce-diagnostics";
import { diagnosticsBetween, diagnosticsForEmails } from "../contacts/bounce-diagnostics";
import { dateTimeFromIso, dateTimeNowAsValue } from "../../shared/dates";
import { applyTransactionalDeliveryStatus } from "../../../../projects/ngx-ramblers/src/app/functions/transactional-delivery-status";

const messageType = "brevo:transactional-emails-list";
const debugLog = debug(envConfig.logNamespace(messageType));
debugLog.enabled = false;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_EVENT_DAYS = 30;

function parsePositiveInt(value: any, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function hasIdentityFilter(email: string, templateId: number | undefined, messageId: string | undefined): boolean {
  return Boolean(email || templateId || messageId);
}

function mapEventToSummary(event: Brevo.GetEmailEventReportResponse.Events.Item): BrevoTransactionalEmailSummary {
  return {
    email: event.email ?? "",
    subject: event.subject ?? "",
    templateId: event.templateId,
    messageId: event.messageId ?? "",
    uuid: "",
    date: event.date ?? "",
    from: event.from,
    event: event.event,
    reason: event.reason
  };
}

function bounceEventType(event: string | undefined): BrevoEventType | null {
  return providerEventToBrevoEventType(event);
}

const DELIVERY_FOLLOW_UP_EVENTS: Brevo.GetEmailEventReportRequest["event"][] = [
  "delivered",
  "softBounces",
  "hardBounces",
  "blocked"
];

async function laterDeliveryEvents(
  client: Awaited<ReturnType<typeof brevoClient>>,
  startDate: string | undefined,
  endDate: string | undefined,
  days: number | undefined,
  sort: Brevo.GetEmailEventReportRequest["sort"],
  limit: number
): Promise<BrevoTransactionalEmailSummary[]> {
  const reports = await Promise.all(DELIVERY_FOLLOW_UP_EVENTS.map(event =>
    scheduleBrevo(() => client.transactionalEmails.getEmailEventReport({
      limit,
      offset: 0,
      startDate,
      endDate,
      days,
      event,
      sort
    }))
  ));
  return reports.flatMap(report => (report.events ?? []).map(mapEventToSummary));
}

async function withDeliveryStatus(
  emails: BrevoTransactionalEmailSummary[],
  event: string | undefined,
  client: Awaited<ReturnType<typeof brevoClient>>,
  startDate: string | undefined,
  endDate: string | undefined,
  days: number | undefined,
  sort: Brevo.GetEmailEventReportRequest["sort"],
  limit: number
): Promise<BrevoTransactionalEmailSummary[]> {
  if (event && event !== BrevoEventType.REQUESTS) {
    return emails;
  } else {
    try {
      const later = await laterDeliveryEvents(client, startDate, endDate, days, sort, limit);
      return applyTransactionalDeliveryStatus(emails, later);
    } catch (error: any) {
      debugLog("laterDeliveryEvents:failed", error?.message || error);
      return applyTransactionalDeliveryStatus(emails, []);
    }
  }
}

async function withBounceDiagnostics(
  emails: BrevoTransactionalEmailSummary[],
  event: string | undefined,
  startDate?: string,
  endDate?: string
): Promise<BrevoTransactionalEmailSummary[]> {
  const bounceType = bounceEventType(event);
  if (!bounceType) {
    return emails;
  } else {
    const fromMs = startDate ? dateTimeFromIso(startDate).startOf("day").toMillis() : 0;
    const toMs = endDate ? dateTimeFromIso(endDate).endOf("day").toMillis() : dateTimeNowAsValue();
    const listed = await diagnosticsForEmails(emails.map(item => item.email));
    const ranged = await diagnosticsBetween(fromMs, toMs, bounceType);
    const combined = [...listed, ...ranged];
    return mergeDiagnosticOnlyTransactionalBounces(
      attachDiagnosticsToTransactionalSummaries(emails, combined),
      ranged,
      bounceType
    );
  }
}

export async function transactionalEmailsList(req: Request, res: Response): Promise<void> {
  try {
    const email = isString(req.query.email) ? (normaliseEmail(req.query.email) || req.query.email.trim()) : "";
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parsePositiveInt(req.query.offset, 0) || 0;
    const templateId = req.query.templateId ? parsePositiveInt(req.query.templateId, 0) : undefined;
    const messageId = isString(req.query.messageId) ? req.query.messageId : undefined;
    const rawStartDate = isString(req.query.startDate) ? req.query.startDate : undefined;
    const rawEndDate = isString(req.query.endDate) ? req.query.endDate : undefined;
    const sort = req.query.sort === "asc" ? "asc" : "desc";
    const client = await brevoClient();
    const { startDate, endDate } = clampDateRange(rawStartDate, rawEndDate);
    if (hasIdentityFilter(email, templateId, messageId)) {
      const response = await scheduleBrevo(() => client.transactionalEmails.getTransacEmailsList({
        email: email || undefined,
        templateId,
        messageId,
        startDate,
        endDate,
        sort,
        limit,
        offset
      }));
      const transactionalEmails = await withBounceDiagnostics(
        await enrichTransactionalEmailOrigins(
          (response.transactionalEmails ?? []) as BrevoTransactionalEmailSummary[]
        ),
        isString(req.query.event) ? req.query.event : undefined,
        startDate,
        endDate
      );
      const body: BrevoTransactionalEmailListResponse = {
        count: response.count ?? transactionalEmails.length,
        transactionalEmails
      };
      successfulResponse({ req, res, response: body, messageType, debugLog });
    } else {
      const days = startDate || endDate ? undefined : DEFAULT_EVENT_DAYS;
      const event = isString(req.query.event)
        ? req.query.event as Brevo.GetEmailEventReportRequest["event"]
        : "requests";
      const response = await scheduleBrevo(() => client.transactionalEmails.getEmailEventReport({
        limit,
        offset,
        startDate,
        endDate,
        days,
        event,
        sort
      }));
      const transactionalEmails = await withDeliveryStatus(
        await withBounceDiagnostics(
          await enrichTransactionalEmailOrigins(
            (response.events ?? []).map(mapEventToSummary)
          ),
          event,
          startDate,
          endDate
        ),
        event,
        client,
        startDate,
        endDate,
        days,
        sort,
        limit
      );
      const body: BrevoTransactionalEmailListResponse = {
        count: transactionalEmails.length,
        transactionalEmails
      };
      successfulResponse({ req, res, response: body, messageType, debugLog });
    }
  } catch (error) {
    handleError(req, res, messageType, debugLog, error);
  }
}
