import expect from "expect";
import {afterEach, beforeEach, describe, it} from "mocha";
import sinon from "sinon";
import * as configuration from "../brevo-config";
import {campaignRecipientExport} from "../../mongo/models/campaign-recipient-export";
import {member} from "../../mongo/models/member";
import {brevoAccountKey, campaignRecipients, recipientSelectorFor} from "./campaign-recipients";
import {parseRecipientExportCsv} from "./campaign-recipient-export";
import {HttpError} from "../../shared/http-error";

describe("campaign recipient reports", () => {
  const sandbox = sinon.createSandbox();
  const accountKey = brevoAccountKey("example-api-key");
  const savedRows = () => parseRecipientExportCsv([
    "Email,Delivered_Date,Hard_Bounce_Date,Soft_Bounce_Date",
    "alex.reed@example.com,01-10-2026 12:01:00,,"
  ].join("\n"));
  const savedExport = (campaignId: number) => sandbox.stub(campaignRecipientExport, "findOne").callsFake((filter: any) => ({
    lean: () => ({exec: () => Promise.resolve(filter.accountKey === accountKey ? {campaignId, accountKey, rows: savedRows(), cachedAt: 1} : null)})
  }) as any);
  const reusedExportClient = (campaignId: number) => ({
    emailCampaigns: {emailExportRecipients: sandbox.stub().resolves({})},
    process: {getProcesses: sandbox.stub().resolves({processes: [{id: 7, status: "completed", export_url: `https://exports.example.com/campaign-[${campaignId}].csv`}]})}
  });
  const deliveredEmails = (response: {json: sinon.SinonSpy}) => response.json.firstCall.args[0].response.recipients.map((recipient: {email: string}) => recipient.email);
  beforeEach(() => sandbox.stub(configuration, "configuredBrevo").resolves({apiKey: "example-api-key"} as any));
  afterEach(() => sandbox.restore());

  it("keeps bounces and undelivered recipients out of Delivered", () => {
    const rows = parseRecipientExportCsv([
      "Email,Delivered_Date,Hard_Bounce_Date,Soft_Bounce_Date",
      "alex.reed@example.com,01-10-2026 12:01:00,,",
      "jordan.blake@example.com,,01-10-2026 12:02:00,",
      "sam.lee@example.com,01-10-2026 12:03:00,,01-10-2026 12:04:00",
      "morgan.lane@example.com,,,"
    ].join("\n"));
    expect(rows.filter(recipientSelectorFor("delivered").select).map(row => row.email)).toEqual(["alex.reed@example.com"]);
    expect(rows.filter(recipientSelectorFor("hardBounces").select).map(row => row.email)).toEqual(["jordan.blake@example.com"]);
    expect(rows.filter(recipientSelectorFor("softBounces").select).map(row => row.email)).toEqual(["sam.lee@example.com"]);
  });

  it("rejects unsupported selectors including inherited object properties", () => {
    for (const type of ["constructor", "__proto__", "unknown"]) {
      expect(() => recipientSelectorFor(type)).toThrow("Unsupported recipient type");
    }
  });

  it("returns an HTTP error when starting an export fails", async () => {
    sandbox.stub(configuration, "brevoClient").rejects(new HttpError(502, "Export failed"));
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "931"}, query: {type: "delivered"}} as any, response as any);
    expect(response.status.calledWith(502)).toBe(true);
    expect(response.json.calledOnce).toBe(true);
  });

  it("rejects invalid requests before contacting Brevo", async () => {
    const client = sandbox.stub(configuration, "brevoClient");
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "-1"}, query: {type: "delivered"}} as any, response as any);
    await campaignRecipients({params: {campaignId: "932"}, query: {type: "unknown"}} as any, response as any);
    expect(client.called).toBe(false);
    expect(response.status.alwaysCalledWith(400)).toBe(true);
  });

  it("uses a saved export when Brevo starts no process", async () => {
    sandbox.stub(configuration, "brevoClient").resolves({
      emailCampaigns: {emailExportRecipients: sandbox.stub().resolves({})},
      process: {getProcesses: sandbox.stub().resolves({processes: []})}
    } as any);
    savedExport(941);
    sandbox.stub(member, "find").returns({lean: () => ({exec: () => Promise.resolve([])})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "941"}, query: {type: "delivered"}} as any, response as any);
    expect(response.status.calledWith(400)).toBe(false);
    expect(deliveredEmails(response)).toEqual(["alex.reed@example.com"]);
  });

  it("does not serve an export saved under a different Brevo account", async () => {
    (configuration.configuredBrevo as sinon.SinonStub).resolves({apiKey: "other-api-key"} as any);
    sandbox.stub(configuration, "brevoClient").resolves({
      emailCampaigns: {emailExportRecipients: sandbox.stub().resolves({})},
      process: {getProcesses: sandbox.stub().resolves({processes: []})}
    } as any);
    savedExport(944);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "944"}, query: {type: "delivered"}} as any, response as any);
    expect(response.status.calledWith(502)).toBe(true);
  });

  it("uses a saved export when a reused export can no longer be downloaded", async () => {
    sandbox.stub(configuration, "brevoClient").resolves(reusedExportClient(945) as any);
    sandbox.stub(global, "fetch").resolves({ok: false, status: 404} as any);
    savedExport(945);
    sandbox.stub(member, "find").returns({lean: () => ({exec: () => Promise.resolve([])})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "945"}, query: {type: "delivered"}} as any, response as any);
    expect(deliveredEmails(response)).toEqual(["alex.reed@example.com"]);
  });

  it("uses the same account configuration for the client, download retry and saved export", async () => {
    const config = configuration.configuredBrevo as sinon.SinonStub;
    config.onSecondCall().resolves({apiKey: "other-api-key"});
    const client = sandbox.stub(configuration, "brevoClient").resolves(reusedExportClient(948) as any);
    const fetch = sandbox.stub(global, "fetch");
    fetch.onFirstCall().resolves({ok: false, status: 403} as Response);
    fetch.onSecondCall().resolves({
      ok: true,
      text: () => Promise.resolve("Email,Delivered_Date\nalex.reed@example.com,01-10-2026 12:01:00")
    } as Response);
    const save = sandbox.stub(campaignRecipientExport, "findOneAndUpdate").resolves(null);
    sandbox.stub(member, "find").returns({lean: () => ({exec: () => Promise.resolve([])})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "948"}, query: {type: "delivered"}} as any, response as any);
    expect(config.callCount).toBe(1);
    expect(client.firstCall.args).toEqual([{apiKey: "example-api-key"}]);
    expect(fetch.secondCall.args[1]).toEqual({headers: {"api-key": "example-api-key"}});
    expect(save.firstCall.args[0]).toEqual({campaignId: 948, accountKey});
    expect(deliveredEmails(response)).toEqual(["alex.reed@example.com"]);
  });

  it("uses a saved export when a reused export has only a header row", async () => {
    sandbox.stub(configuration, "brevoClient").resolves(reusedExportClient(946) as any);
    sandbox.stub(global, "fetch").resolves({ok: true, text: () => Promise.resolve("Email,Delivered_Date,Hard_Bounce_Date,Soft_Bounce_Date\n")} as any);
    savedExport(946);
    sandbox.stub(member, "find").returns({lean: () => ({exec: () => Promise.resolve([])})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "946"}, query: {type: "delivered"}} as any, response as any);
    expect(deliveredEmails(response)).toEqual(["alex.reed@example.com"]);
  });

  it("reports a download failure when a reused export cannot be read and nothing is saved", async () => {
    sandbox.stub(configuration, "brevoClient").resolves(reusedExportClient(947) as any);
    sandbox.stub(global, "fetch").resolves({ok: false, status: 403} as any);
    sandbox.stub(campaignRecipientExport, "findOne").returns({lean: () => ({exec: () => Promise.resolve(null)})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "947"}, query: {type: "delivered"}} as any, response as any);
    expect(response.status.calledWith(502)).toBe(true);
  });

  it("still errors when Brevo starts no process and nothing is saved", async () => {
    sandbox.stub(configuration, "brevoClient").resolves({
      emailCampaigns: {emailExportRecipients: sandbox.stub().resolves({})},
      process: {getProcesses: sandbox.stub().resolves({processes: []})}
    } as any);
    sandbox.stub(campaignRecipientExport, "findOne").returns({lean: () => ({exec: () => Promise.resolve(null)})} as any);
    const response = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    await campaignRecipients({params: {campaignId: "942"}, query: {type: "delivered"}} as any, response as any);
    expect(response.status.calledWith(502)).toBe(true);
  });
});
