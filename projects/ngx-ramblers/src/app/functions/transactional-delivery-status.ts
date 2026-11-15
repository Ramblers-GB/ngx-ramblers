import { bounceExplanationFor } from "./brevo-bounce-diagnostics";
import { normaliseEmail } from "./strings";
import {
  BrevoEventType,
  BrevoTransactionalEmailSummary,
  MailReportEventFilter,
  MailTransactionalDeliveryStatus
} from "../models/mail.model";

const STATUS_RANK: Record<MailTransactionalDeliveryStatus, number> = {
  [MailTransactionalDeliveryStatus.SENT]: 0,
  [MailTransactionalDeliveryStatus.DELIVERED]: 1,
  [MailTransactionalDeliveryStatus.SOFT_BOUNCE]: 2,
  [MailTransactionalDeliveryStatus.BLOCKED]: 3,
  [MailTransactionalDeliveryStatus.HARD_BOUNCE]: 4
};

export function mailReportEventForDeliveryStatus(status: MailTransactionalDeliveryStatus): MailReportEventFilter {
  if (status === MailTransactionalDeliveryStatus.HARD_BOUNCE) {
    return MailReportEventFilter.HARD_BOUNCES;
  } else if (status === MailTransactionalDeliveryStatus.SOFT_BOUNCE) {
    return MailReportEventFilter.SOFT_BOUNCES;
  } else if (status === MailTransactionalDeliveryStatus.BLOCKED) {
    return MailReportEventFilter.BLOCKED;
  } else if (status === MailTransactionalDeliveryStatus.DELIVERED) {
    return MailReportEventFilter.DELIVERED;
  } else {
    return MailReportEventFilter.SENT;
  }
}

export function deliveryStatusForEvent(event: string | undefined): MailTransactionalDeliveryStatus {
  const value = String(event || "");
  if (value === BrevoEventType.HARD_BOUNCES || value === "hard_bounce" || value === "hardBounce") {
    return MailTransactionalDeliveryStatus.HARD_BOUNCE;
  } else if (value === BrevoEventType.SOFT_BOUNCES || value === "soft_bounce" || value === "softBounce") {
    return MailTransactionalDeliveryStatus.SOFT_BOUNCE;
  } else if (value === BrevoEventType.BLOCKED || value === "blocked") {
    return MailTransactionalDeliveryStatus.BLOCKED;
  } else if (value === BrevoEventType.DELIVERED || value === "delivered") {
    return MailTransactionalDeliveryStatus.DELIVERED;
  } else {
    return MailTransactionalDeliveryStatus.SENT;
  }
}

function rowKey(email: Pick<BrevoTransactionalEmailSummary, "email" | "messageId">): string {
  const messageId = String(email.messageId || "").trim();
  const address = normaliseEmail(email.email) || String(email.email || "").trim().toLowerCase();
  return messageId && address ? `${messageId}|${address}` : null;
}

export function applyTransactionalDeliveryStatus(
  sent: BrevoTransactionalEmailSummary[],
  laterEvents: BrevoTransactionalEmailSummary[]
): BrevoTransactionalEmailSummary[] {
  const bestByKey = new Map<string, BrevoTransactionalEmailSummary>();
  laterEvents.filter(event => !!rowKey(event)).forEach(event => {
    const status = deliveryStatusForEvent(event.event);
    const key = rowKey(event);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, {...event, deliveryStatus: status});
    } else {
      const existingRank = STATUS_RANK[existing.deliveryStatus || MailTransactionalDeliveryStatus.SENT];
      if (STATUS_RANK[status] >= existingRank) {
        bestByKey.set(key, {
          ...existing,
          ...event,
          deliveryStatus: status,
          reason: event.reason || existing.reason
        });
      }
    }
  });
  return sent.map(row => {
    const match = bestByKey.get(rowKey(row));
    const deliveryStatus = match?.deliveryStatus || MailTransactionalDeliveryStatus.SENT;
    const reason = match?.reason || row.reason;
    return {
      ...row,
      deliveryStatus,
      reason,
      bounceExplanation: row.bounceExplanation || bounceExplanationFor(reason) || undefined
    };
  });
}
