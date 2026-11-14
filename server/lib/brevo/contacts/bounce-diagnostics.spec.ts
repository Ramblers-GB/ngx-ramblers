import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as dates from "../../shared/dates";
import * as model from "../../mongo/models/brevo-bounce-diagnostic";
import { persistBounceDiagnostic } from "./bounce-diagnostics";

const sandbox = sinon.createSandbox();

describe("persistBounceDiagnostic", () => {
  beforeEach(() => {
    sandbox.stub(dates, "dateTimeNowAsValue").returns(1760000000000);
  });
  afterEach(() => sandbox.restore());

  it("upserts a hard bounce webhook payload by eventKey", async () => {
    const updateOne = sandbox.stub(model.brevoBounceDiagnostic, "updateOne").resolves({} as any);
    const diagnostic = await persistBounceDiagnostic({
      event: "hard_bounce",
      email: "alex.reed@example.com",
      reason: "550 5.4.1 Recipient address rejected: Access denied",
      camp_id: 12,
      sending_ip: "1.2.3.4",
      ts: 1760000000,
      "message-id": "<campaign-1@example.com>"
    }, "member-1");
    expect(diagnostic?.email).toBe("alex.reed@example.com");
    expect(updateOne.calledOnce).toBe(true);
    expect(updateOne.firstCall.args[0]).toEqual({eventKey: diagnostic?.eventKey});
    expect(updateOne.firstCall.args[2]).toEqual({upsert: true});
    expect(updateOne.firstCall.args[1].$set.campaignId).toBe(12);
    expect(updateOne.firstCall.args[1].$set.sendingIp).toBe("1.2.3.4");
  });

  it("is a no-op for delivered events", async () => {
    const updateOne = sandbox.stub(model.brevoBounceDiagnostic, "updateOne").resolves({} as any);
    const diagnostic = await persistBounceDiagnostic({event: "delivered", email: "alex.reed@example.com"});
    expect(diagnostic).toBeNull();
    expect(updateOne.called).toBe(false);
  });

});
