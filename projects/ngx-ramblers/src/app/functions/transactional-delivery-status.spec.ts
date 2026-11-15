import { BrevoEventType, MAIL_TRANSACTIONAL_DELIVERY_STATUS_LABELS, MailReportEventFilter, MailTransactionalDeliveryStatus } from "../models/mail.model";
import { applyTransactionalDeliveryStatus, deliveryStatusForEvent, mailReportEventForDeliveryStatus } from "./transactional-delivery-status";

describe("transactional-delivery-status", () => {
  it("maps Brevo events to delivery status", () => {
    expect(deliveryStatusForEvent(BrevoEventType.HARD_BOUNCES)).toBe(MailTransactionalDeliveryStatus.HARD_BOUNCE);
    expect(deliveryStatusForEvent(BrevoEventType.DELIVERED)).toBe(MailTransactionalDeliveryStatus.DELIVERED);
    expect(deliveryStatusForEvent(BrevoEventType.REQUESTS)).toBe(MailTransactionalDeliveryStatus.SENT);
  });

  it("opens the matching Mail Reports tile for a delivery status", () => {
    expect(mailReportEventForDeliveryStatus(MailTransactionalDeliveryStatus.HARD_BOUNCE)).toBe(MailReportEventFilter.HARD_BOUNCES);
    expect(mailReportEventForDeliveryStatus(MailTransactionalDeliveryStatus.DELIVERED)).toBe(MailReportEventFilter.DELIVERED);
  });

  it("prefers a hard bounce over delivered for the same message", () => {
    const sent = [{
      email: "alex.reed@example.com",
      subject: "Friday email",
      messageId: "msg-1",
      uuid: "",
      date: "2026-11-15T21:45:00.000Z",
      event: BrevoEventType.REQUESTS
    }];
    const later = [
      {
        ...sent[0],
        event: BrevoEventType.DELIVERED
      },
      {
        ...sent[0],
        event: BrevoEventType.HARD_BOUNCES,
        reason: "550 Mail Box does not exist"
      }
    ];
    const rows = applyTransactionalDeliveryStatus(sent, later);
    expect(rows[0].deliveryStatus).toBe(MailTransactionalDeliveryStatus.HARD_BOUNCE);
    expect(rows[0].reason).toContain("Mail Box");
    expect(rows[0].bounceExplanation).toBe("The mailbox does not exist.");
  });

  it("shows an unverified outcome when no event can be matched to the message", () => {
    const sent = {email: "alex.reed@example.com", subject: "Friday email", messageId: "", uuid: "", date: ""};
    const [row] = applyTransactionalDeliveryStatus([sent], [{...sent, event: BrevoEventType.HARD_BOUNCES}]);
    expect(MAIL_TRANSACTIONAL_DELIVERY_STATUS_LABELS[row.deliveryStatus]).toBe("Delivery unverified");
  });
});
