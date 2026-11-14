import { isNumber, isString } from "es-toolkit/compat";
import {
  BREVO_EVENT_LABELS,
  BrevoBounceDiagnostic,
  BrevoContactCampaignStats,
  BrevoContactStatisticsCount,
  BrevoEmailEvent,
  BrevoEventSource,
  BrevoEventType
} from "../models/mail.model";
import { normaliseEmail } from "./strings";

const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

export function providerEventToBrevoEventType(providerEvent: string | undefined): BrevoEventType | null {
  const event = String(providerEvent || "").trim();
  if (event === "hard_bounce" || event === "hardBounce" || event === BrevoEventType.HARD_BOUNCES) {
    return BrevoEventType.HARD_BOUNCES;
  } else if (event === "soft_bounce" || event === "softBounce" || event === BrevoEventType.SOFT_BOUNCES) {
    return BrevoEventType.SOFT_BOUNCES;
  } else {
    return null;
  }
}

export function bounceExplanationFor(reason: string | undefined): string | null {
  const text = String(reason || "").trim();
  if (!text) {
    return null;
  } else {
    const smtp = text.match(/\b(\d{3})\s+(5\.\d+\.\d+)\b/);
    const code = smtp ? smtp[2] : "";
    if (code.indexOf("5.4.1") === 0 || /recipient address rejected/i.test(text)) {
      return "The receiving mail server rejected this address.";
    } else if (code.indexOf("5.7.1") === 0 && /spamhaus|client host blocked|blocked using/i.test(text)) {
      return "The receiving mail server blocked the sending mail server.";
    } else {
      return null;
    }
  }
}

export function bounceEventKeyFromPayload(payload: Record<string, unknown>): string {
  const email = normaliseEmail(String(payload?.email || "")) || "";
  const providerEvent = String(payload?.event || "");
  const messageId = String(payload?.["message-id"] || payload?.messageId || payload?.id || "");
  const campaignId = campaignIdFromPayload(payload);
  const eventAt = eventAtFromPayload(payload);
  return `${providerEvent}:${messageId}:${campaignId ?? ""}:${email}:${eventAt}`;
}

export function campaignIdFromPayload(payload: Record<string, unknown>): number | undefined {
  const raw = payload?.camp_id ?? payload?.campaign_id ?? payload?.campaignId;
  const parsed = isNumber(raw) ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  } else {
    return undefined;
  }
}

export function sendingIpFromPayload(payload: Record<string, unknown>): string | undefined {
  const raw = payload?.sending_ip ?? payload?.sendingIp ?? payload?.ip;
  const ip = isString(raw) ? raw.trim() : "";
  if (ip) {
    return ip;
  } else {
    return undefined;
  }
}

export function eventAtFromPayload(payload: Record<string, unknown>, fallback = 0): number {
  const ts = payload?.ts_event ?? payload?.ts ?? payload?.date;
  if (isNumber(ts) && Number.isFinite(ts)) {
    return ts < 1e12 ? ts * 1000 : ts;
  } else if (isString(ts)) {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) {
      return parsed;
    } else {
      return fallback;
    }
  } else {
    return fallback;
  }
}

export function diagnosticFromWebhookPayload(payload: Record<string, unknown>, memberId?: string, receivedAt = 0): BrevoBounceDiagnostic | null {
  const email = normaliseEmail(String(payload?.email || ""));
  const providerEvent = String(payload?.event || "");
  const event = providerEventToBrevoEventType(providerEvent);
  const eventAt = eventAtFromPayload(payload, receivedAt);
  if (!email || !event || !eventAt) {
    return null;
  } else {
    const reason = String(payload?.reason || "").trim() || undefined;
    const messageId = String(payload?.["message-id"] || payload?.messageId || "").trim() || undefined;
    return {
      eventKey: bounceEventKeyFromPayload(payload),
      email,
      memberId,
      providerEvent,
      event,
      reason,
      sendingIp: sendingIpFromPayload(payload),
      campaignId: campaignIdFromPayload(payload),
      messageId,
      eventAt
    };
  }
}

function isBounceType(event: string | undefined): boolean {
  return event === BrevoEventType.HARD_BOUNCES || event === BrevoEventType.SOFT_BOUNCES;
}

function diagnosticMatchesEvent(diagnostic: BrevoBounceDiagnostic, event: BrevoEmailEvent): boolean {
  const eventType = providerEventToBrevoEventType(String(event.event));
  if (!eventType || diagnostic.event !== eventType) {
    return false;
  } else {
    const eventCampaign = event.campaignId;
    if (isNumber(eventCampaign) && isNumber(diagnostic.campaignId) && eventCampaign !== diagnostic.campaignId) {
      return false;
    } else {
      const eventAt = Date.parse(event.date);
      if (!Number.isFinite(eventAt)) {
        return isNumber(eventCampaign) && eventCampaign === diagnostic.campaignId;
      } else {
        return Math.abs(eventAt - diagnostic.eventAt) <= MATCH_WINDOW_MS;
      }
    }
  }
}

function bestDiagnostic(event: BrevoEmailEvent, diagnostics: BrevoBounceDiagnostic[], used: Set<string>): BrevoBounceDiagnostic | null {
  const eventAt = Date.parse(event.date) || 0;
  const matches = diagnostics
    .filter(diagnostic => !used.has(diagnostic.eventKey) && diagnosticMatchesEvent(diagnostic, event))
    .sort((left, right) => Math.abs(left.eventAt - eventAt) - Math.abs(right.eventAt - eventAt));
  if (matches.length === 0) {
    return null;
  } else {
    return matches[0];
  }
}

function withDiagnostic(event: BrevoEmailEvent, diagnostic: BrevoBounceDiagnostic | null): BrevoEmailEvent {
  const reason = event.reason || diagnostic?.reason;
  const sendingIp = diagnostic?.sendingIp || event.sendingIp;
  const available = !!(reason || sendingIp);
  return {
    ...event,
    reason,
    sendingIp,
    campaignId: event.campaignId ?? diagnostic?.campaignId,
    bounceExplanation: bounceExplanationFor(reason),
    bounceDetailsAvailable: available
  };
}

export function attachDiagnosticsToEvents(events: BrevoEmailEvent[], diagnostics: BrevoBounceDiagnostic[]): BrevoEmailEvent[] {
  const used = new Set<string>();
  return events.map(event => {
    if (!isBounceType(String(event.event))) {
      return event;
    } else {
      const match = bestDiagnostic(event, diagnostics, used);
      if (match) {
        used.add(match.eventKey);
      }
      return withDiagnostic(event, match);
    }
  });
}

function attachToCountItems(
  items: BrevoContactStatisticsCount[] | undefined,
  eventType: BrevoEventType,
  email: string,
  diagnostics: BrevoBounceDiagnostic[],
  used: Set<string>
): BrevoContactStatisticsCount[] | undefined {
  if (!items) {
    return items;
  } else {
    return items.map(item => {
      const event: BrevoEmailEvent = {
        email,
        date: item.eventTime || "",
        messageId: "",
        event: eventType,
        campaignId: item.campaignId,
        source: BrevoEventSource.CAMPAIGN
      };
      const match = bestDiagnostic(event, diagnostics, used);
      if (match) {
        used.add(match.eventKey);
      }
      const attached = withDiagnostic(event, match);
      return {
        ...item,
        reason: attached.reason,
        sendingIp: attached.sendingIp,
        bounceExplanation: attached.bounceExplanation,
        bounceDetailsAvailable: attached.bounceDetailsAvailable
      };
    });
  }
}

export function attachDiagnosticsToCampaignStats(
  stats: BrevoContactCampaignStats | null | undefined,
  diagnostics: BrevoBounceDiagnostic[],
  email = ""
): BrevoContactCampaignStats | null | undefined {
  if (!stats) {
    return stats;
  } else {
    const used = new Set<string>();
    return {
      ...stats,
      hardBounces: attachToCountItems(stats.hardBounces, BrevoEventType.HARD_BOUNCES, email, diagnostics, used),
      softBounces: attachToCountItems(stats.softBounces, BrevoEventType.SOFT_BOUNCES, email, diagnostics, used)
    };
  }
}

export function bounceCopyText(event: BrevoEmailEvent): string {
  const lines = [
    `Event: ${BREVO_EVENT_LABELS[String(event.event)] || event.event}${event.source ? ` (${event.source})` : ""}`,
    event.date ? `Date: ${event.date}` : "",
    event.email ? `Recipient: ${event.email}` : "",
    event.campaignId ? `Campaign id: ${event.campaignId}` : "",
    event.sendingIp ? `Sending IP: ${event.sendingIp}` : "",
    event.reason ? `Server response: ${event.reason}` : "Server response: not available in NGX"
  ];
  return lines.filter(line => !!line).join("\n");
}
