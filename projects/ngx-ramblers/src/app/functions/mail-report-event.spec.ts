import { BrevoEventType, MailReportEventFilter } from "../models/mail.model";
import { brevoEventForMailReport, isBounceMailReportEvent, mailReportEventFromQuery } from "./mail-report-event";

describe("mail-report-event", () => {
  it("maps hard bounces to the Brevo event name", () => {
    expect(brevoEventForMailReport(MailReportEventFilter.HARD_BOUNCES)).toBe(BrevoEventType.HARD_BOUNCES);
    expect(brevoEventForMailReport(MailReportEventFilter.SENT)).toBe(BrevoEventType.REQUESTS);
  });

  it("recognises bounce filters", () => {
    expect(isBounceMailReportEvent(MailReportEventFilter.HARD_BOUNCES)).toBe(true);
    expect(isBounceMailReportEvent(MailReportEventFilter.SENT)).toBe(false);
  });

  it("reads a stored event-type query value", () => {
    expect(mailReportEventFromQuery("hard-bounces")).toBe(MailReportEventFilter.HARD_BOUNCES);
    expect(mailReportEventFromQuery("nope")).toBeNull();
  });
});
