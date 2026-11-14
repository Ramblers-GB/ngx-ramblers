import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import { Request, Response } from "express";
import * as brevoConfig from "../brevo-config";
import * as rateLimiting from "../common/rate-limiting";
import * as bounceDiagnostics from "./bounce-diagnostics";
import { contactCampaignStats } from "./contact-campaign-stats";
import { BrevoEventType } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";

const sandbox = sinon.createSandbox();

describe("contactCampaignStats bounce diagnostics", () => {
  beforeEach(() => {
    sandbox.stub(rateLimiting, "scheduleBrevo").callsFake(async task => task());
  });
  afterEach(() => sandbox.restore());

  it("attaches a stored hard-bounce reason onto campaign statistics", async () => {
    sandbox.stub(brevoConfig, "brevoClient").resolves({
      contacts: {getContactStats: sandbox.stub().resolves({hardBounces: [{campaignId: 12, eventTime: "2026-11-06T10:43:45.000Z"}]})}
    } as any);
    sandbox.stub(bounceDiagnostics, "diagnosticsForEmail").resolves([{
      eventKey: "hard_bounce:msg:12:alex.reed@example.com:1",
      email: "alex.reed@example.com",
      providerEvent: "hard_bounce",
      event: BrevoEventType.HARD_BOUNCES,
      reason: "550 5.4.1 Recipient address rejected: Access denied",
      sendingIp: "1.2.3.4",
      campaignId: 12,
      eventAt: Date.parse("2026-11-06T10:43:45.000Z")
    }]);
    const response = {status: sandbox.stub(), json: sandbox.stub()};
    response.status.returns(response);
    await contactCampaignStats({params: {identifier: "Alex.Reed@example.com"}, query: {}} as unknown as Request, response as unknown as Response);
    const stats = response.json.firstCall.args[0].response;
    expect(stats.hardBounces[0].reason).toContain("550 5.4.1");
    expect(stats.hardBounces[0].sendingIp).toBe("1.2.3.4");
  });
});
