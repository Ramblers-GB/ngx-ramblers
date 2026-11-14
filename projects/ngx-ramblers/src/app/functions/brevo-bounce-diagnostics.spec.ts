import {
  attachDiagnosticsToCampaignStats,
  attachDiagnosticsToEvents,
  bounceCopyText,
  bounceExplanationFor,
  diagnosticFromWebhookPayload,
  providerEventToBrevoEventType
} from "./brevo-bounce-diagnostics";
import { BrevoBounceDiagnostic, BrevoEventSource, BrevoEventType } from "../models/mail.model";

const email = "alex.reed@example.com";

function diagnostic(partial: Partial<BrevoBounceDiagnostic> = {}): BrevoBounceDiagnostic {
  return {
    eventKey: partial.eventKey || "hard_bounce:msg:12:alex.reed@example.com:1760000000000",
    email,
    providerEvent: "hard_bounce",
    event: BrevoEventType.HARD_BOUNCES,
    reason: "550 5.4.1 Recipient address rejected: Access denied. [BN9NAM12FT069.eop-nam12.prod.protection.outlook.com 2026-11-06T10:43:45.000Z]",
    sendingIp: "1.2.3.4",
    campaignId: 12,
    messageId: "msg",
    eventAt: Date.parse("2026-11-06T10:43:45.000Z"),
    ...partial
  };
}

describe("providerEventToBrevoEventType", () => {
  it("maps webhook and statistics names", () => {
    expect(providerEventToBrevoEventType("hard_bounce")).toBe(BrevoEventType.HARD_BOUNCES);
    expect(providerEventToBrevoEventType("soft_bounce")).toBe(BrevoEventType.SOFT_BOUNCES);
    expect(providerEventToBrevoEventType("unsubscribed")).toBeNull();
  });
});

describe("bounceExplanationFor", () => {
  it("explains a 5.4.1 recipient rejection", () => {
    expect(bounceExplanationFor("550 5.4.1 Recipient address rejected: Access denied")).toBe(
      "The receiving mail server rejected this address."
    );
  });

  it("explains a 5.7.1 Spamhaus block", () => {
    expect(bounceExplanationFor("550 5.7.1 Service unavailable; Client host blocked using Spamhaus")).toBe(
      "The receiving mail server blocked the sending mail server."
    );
  });

  it("does not invent a cause for Access denied", () => {
    expect(bounceExplanationFor("Access denied")).toBeNull();
  });

  it("leaves an empty reason empty", () => {
    expect(bounceExplanationFor("")).toBeNull();
    expect(bounceExplanationFor(undefined)).toBeNull();
  });
});

describe("diagnosticFromWebhookPayload", () => {
  it("reads camp_id, sending_ip and reason from a marketing webhook", () => {
    const diagnosticRow = diagnosticFromWebhookPayload({
      event: "hard_bounce",
      email: "Alex.Reed@example.com",
      reason: "550 5.4.1 Recipient address rejected: Access denied",
      camp_id: 12,
      sending_ip: "1.2.3.4",
      ts: 1760000000,
      "message-id": "<campaign-1@example.com>"
    }, "member-1", 1760000000000);
    expect(diagnosticRow?.email).toBe(email);
    expect(diagnosticRow?.campaignId).toBe(12);
    expect(diagnosticRow?.sendingIp).toBe("1.2.3.4");
    expect(diagnosticRow?.event).toBe(BrevoEventType.HARD_BOUNCES);
    expect(diagnosticRow?.memberId).toBe("member-1");
  });

  it("ignores events that are not campaign bounces", () => {
    expect(diagnosticFromWebhookPayload({event: "delivered", email})).toBeNull();
  });
});

describe("attachDiagnosticsToEvents", () => {
  it("attaches a matching campaign bounce without adding a second timeline row", () => {
    const events = attachDiagnosticsToEvents([{
      email,
      date: "2026-11-06T10:43:45.000Z",
      messageId: "",
      event: BrevoEventType.HARD_BOUNCES,
      campaignId: 12,
      source: BrevoEventSource.CAMPAIGN
    }], [diagnostic()]);
    expect(events.length).toBe(1);
    expect(events[0].reason).toContain("550 5.4.1");
    expect(events[0].sendingIp).toBe("1.2.3.4");
    expect(events[0].bounceExplanation).toBe("The receiving mail server rejected this address.");
    expect(events[0].bounceDetailsAvailable).toBe(true);
  });

  it("keeps the provider soft-bounce label when the SMTP code is 5xx", () => {
    const events = attachDiagnosticsToEvents([{
      email,
      date: "2026-11-06T10:43:45.000Z",
      messageId: "",
      event: BrevoEventType.SOFT_BOUNCES,
      campaignId: 12,
      source: BrevoEventSource.CAMPAIGN
    }], [diagnostic({
      providerEvent: "soft_bounce",
      event: BrevoEventType.SOFT_BOUNCES,
      reason: "550 5.7.1 Service unavailable; Client host blocked using Spamhaus"
    })]);
    expect(events[0].event).toBe(BrevoEventType.SOFT_BOUNCES);
    expect(events[0].bounceExplanation).toBe("The receiving mail server blocked the sending mail server.");
  });

  it("does not reuse one diagnostic on two bounces", () => {
    const events = attachDiagnosticsToEvents([
      {email, date: "2026-11-06T10:43:45.000Z", messageId: "", event: BrevoEventType.HARD_BOUNCES, campaignId: 12, source: BrevoEventSource.CAMPAIGN},
      {email, date: "2026-11-06T10:43:50.000Z", messageId: "", event: BrevoEventType.HARD_BOUNCES, campaignId: 12, source: BrevoEventSource.CAMPAIGN}
    ], [diagnostic()]);
    expect(events.filter(event => event.reason).length).toBe(1);
  });

  it("marks a campaign bounce with no stored reason as unavailable", () => {
    const events = attachDiagnosticsToEvents([{
      email,
      date: "2026-11-06T10:43:45.000Z",
      messageId: "",
      event: BrevoEventType.HARD_BOUNCES,
      campaignId: 99,
      source: BrevoEventSource.CAMPAIGN
    }], []);
    expect(events[0].bounceDetailsAvailable).toBe(false);
    expect(events[0].reason).toBeUndefined();
  });

  it("does not attach a diagnostic for a different campaign", () => {
    const events = attachDiagnosticsToEvents([{
      email,
      date: "2026-11-06T10:43:45.000Z",
      messageId: "",
      event: BrevoEventType.HARD_BOUNCES,
      campaignId: 99,
      source: BrevoEventSource.CAMPAIGN
    }], [diagnostic()]);
    expect(events[0].reason).toBeUndefined();
    expect(events[0].bounceDetailsAvailable).toBe(false);
  });
});

describe("attachDiagnosticsToCampaignStats", () => {
  it("copies diagnostics onto matching hard bounce rows", () => {
    const stats = attachDiagnosticsToCampaignStats({
      hardBounces: [{campaignId: 12, eventTime: "2026-11-06T10:43:45.000Z"}]
    }, [diagnostic()], email);
    expect(stats?.hardBounces?.[0].reason).toContain("550 5.4.1");
    expect(stats?.hardBounces?.[0].sendingIp).toBe("1.2.3.4");
  });
});

describe("bounceCopyText", () => {
  it("includes the provider response and sending IP", () => {
    const text = bounceCopyText({
      email,
      date: "2026-11-06T10:43:45.000Z",
      messageId: "",
      event: BrevoEventType.HARD_BOUNCES,
      campaignId: 12,
      sendingIp: "1.2.3.4",
      reason: "550 5.4.1 Recipient address rejected: Access denied",
      source: BrevoEventSource.CAMPAIGN
    });
    expect(text).toContain("Hard bounce (campaign)");
    expect(text).toContain("Campaign id: 12");
    expect(text).toContain("Sending IP: 1.2.3.4");
    expect(text).toContain("550 5.4.1");
  });
});
