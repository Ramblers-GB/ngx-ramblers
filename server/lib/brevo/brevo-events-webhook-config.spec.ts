import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import { BrevoClient, BrevoError } from "@getbrevo/brevo";
import * as config from "../mongo/controllers/config";
import * as system from "../config/system-config";
import * as rateLimiting from "./common/rate-limiting";
import { ensureBrevoMarketingBounceWebhook } from "./brevo-events-webhook-config";

describe("campaign bounce webhook setup", () => {
  const sandbox = sinon.createSandbox();
  const url = "https://group.example.org.uk/api/mail/webhooks/brevo-events?token=example-token";

  beforeEach(() => {
    sandbox.stub(config, "queryKey").resolves({value: {brevoEventsWebhookSecret: "example-token"}} as any);
    sandbox.stub(system, "systemConfig").resolves({group: {href: "https://group.example.org.uk"}} as any);
    sandbox.stub(rateLimiting, "scheduleBrevo").callsFake(async task => task());
  });

  afterEach(() => sandbox.restore());

  function client() {
    const getWebhooks = sandbox.stub();
    const createWebhook = sandbox.stub().resolves();
    const updateWebhook = sandbox.stub().resolves();
    return {brevo: {webhooks: {getWebhooks, createWebhook, updateWebhook}} as unknown as BrevoClient, getWebhooks, createWebhook, updateWebhook};
  }

  it("creates one marketing webhook when Brevo reports no webhooks", async () => {
    const {brevo, getWebhooks, createWebhook} = client();
    getWebhooks.rejects(new BrevoError({statusCode: 400, body: {code: "document_not_found"}}));
    await Promise.all([ensureBrevoMarketingBounceWebhook(brevo), ensureBrevoMarketingBounceWebhook(brevo)]);
    expect(createWebhook.calledOnce).toBe(true);
    expect(createWebhook.firstCall.args[0]).toMatchObject({url, type: "marketing", channel: "email", events: ["hardBounce", "softBounce"]});
  });

  it("adds the missing event without replacing existing subscriptions", async () => {
    const {brevo, getWebhooks, createWebhook, updateWebhook} = client();
    getWebhooks.resolves({webhooks: [{id: 42, url, events: ["hardBounce", "unsubscribed"]}]});
    await ensureBrevoMarketingBounceWebhook(brevo);
    expect(updateWebhook.firstCall.args[0]).toEqual({webhookId: 42, events: ["hardBounce", "unsubscribed", "softBounce"]});
    expect(createWebhook.called).toBe(false);
  });

  it("leaves a matching complete subscription alone", async () => {
    const {brevo, getWebhooks, createWebhook, updateWebhook} = client();
    getWebhooks.resolves({webhooks: [{id: 42, url, events: ["hardBounce", "softBounce"]}]});
    await ensureBrevoMarketingBounceWebhook(brevo);
    expect(createWebhook.called || updateWebhook.called).toBe(false);
  });
});
