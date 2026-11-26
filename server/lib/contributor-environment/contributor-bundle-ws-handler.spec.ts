import expect from "expect";
import sinon from "sinon";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as requestMember from "../auth/request-member";
import * as bundleService from "./contributor-bundle-service";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { handleContributorBundle } from "./contributor-bundle-ws-handler";

function fakeSocket() {
  const sent: {type: MessageType; data: Record<string, unknown>}[] = [];
  return {ws: {readyState: WebSocket.OPEN, send: (message: string) => sent.push(JSON.parse(message))}, sent};
}

describe("handleContributorBundle", () => {
  const state: {sandbox: sinon.SinonSandbox | null} = {sandbox: null};
  const request = {requestId: "request-1", environmentName: "hillside", schema: "ngx-ramblers-hillside-dev", clone: true};

  beforeEach(() => {
    state.sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    state.sandbox.restore();
  });

  it("refuses anyone who is not a member admin", async () => {
    state.sandbox.stub(requestMember, "memberFromRequest").resolves({memberId: "member-1", memberAdmin: false} as never);
    const generate = state.sandbox.stub(bundleService, "generateContributorBundle");
    const {ws, sent} = fakeSocket();
    await handleContributorBundle(ws as never, request, "token");
    expect(sent).toEqual([{type: MessageType.ERROR, data: {requestId: "request-1", message: "Sign in as a member admin to generate a contributor environment"}}]);
    expect(generate.called).toBe(false);
  });

  it("keeps the requesting member, reports progress and returns the zip", async () => {
    state.sandbox.stub(requestMember, "memberFromRequest").resolves({memberId: "member-1", memberAdmin: true} as never);
    const generate = state.sandbox.stub(bundleService, "generateContributorBundle").callsFake(async (_options, _keep, onProgress) => {
      onProgress("Copying");
      return {fileName: "contributor-environment-hillside.zip", zip: Buffer.from("zip")};
    });
    const {ws, sent} = fakeSocket();
    await handleContributorBundle(ws as never, request, "token");
    expect(generate.firstCall.args.slice(0, 2)).toEqual([{environmentName: "hillside", schema: "ngx-ramblers-hillside-dev", clone: true}, "member-1"]);
    expect(sent).toEqual([
      {type: MessageType.PROGRESS, data: {requestId: "request-1", message: "Copying"}},
      {type: MessageType.COMPLETE, data: {requestId: "request-1", fileName: "contributor-environment-hillside.zip", zipBase64: Buffer.from("zip").toString("base64")}}
    ]);
  });

  it("passes a failure back as an error for this request", async () => {
    state.sandbox.stub(requestMember, "memberFromRequest").resolves({memberId: "member-1", memberAdmin: true} as never);
    state.sandbox.stub(bundleService, "generateContributorBundle").rejects(new Error("Atlas said no"));
    const {ws, sent} = fakeSocket();
    await handleContributorBundle(ws as never, request, "token");
    expect(sent).toEqual([{type: MessageType.ERROR, data: {requestId: "request-1", message: "Atlas said no"}}]);
  });
});
