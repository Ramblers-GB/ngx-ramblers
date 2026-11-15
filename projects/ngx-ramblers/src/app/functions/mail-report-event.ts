import { values } from "es-toolkit/compat";
import { BrevoEventType, MailReportEventFilter } from "../models/mail.model";

export function brevoEventForMailReport(filter: MailReportEventFilter): string {
  if (filter === MailReportEventFilter.SENT) {
    return BrevoEventType.REQUESTS;
  } else if (filter === MailReportEventFilter.DELIVERED) {
    return BrevoEventType.DELIVERED;
  } else if (filter === MailReportEventFilter.OPENS) {
    return BrevoEventType.OPENED;
  } else if (filter === MailReportEventFilter.CLICKS) {
    return BrevoEventType.CLICKS;
  } else if (filter === MailReportEventFilter.HARD_BOUNCES) {
    return BrevoEventType.HARD_BOUNCES;
  } else if (filter === MailReportEventFilter.SOFT_BOUNCES) {
    return BrevoEventType.SOFT_BOUNCES;
  } else if (filter === MailReportEventFilter.UNSUBS) {
    return BrevoEventType.UNSUBSCRIBED;
  } else if (filter === MailReportEventFilter.COMPLAINTS) {
    return BrevoEventType.SPAM;
  } else if (filter === MailReportEventFilter.BLOCKED) {
    return BrevoEventType.BLOCKED;
  } else {
    return BrevoEventType.REQUESTS;
  }
}

export function isBounceMailReportEvent(filter: MailReportEventFilter): boolean {
  return filter === MailReportEventFilter.HARD_BOUNCES || filter === MailReportEventFilter.SOFT_BOUNCES;
}

export function mailReportEventFromQuery(value: string | null | undefined): MailReportEventFilter | null {
  const match = values(MailReportEventFilter).find(item => item === value);
  if (match) {
    return match;
  } else {
    return null;
  }
}
