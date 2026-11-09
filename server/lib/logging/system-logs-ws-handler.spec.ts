import { member } from "../mongo/models/member";
import expect from "expect";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { envConfig } from "../env-config/env-config";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { appendSystemLog, clearSystemLogs } from "./system-log-buffer";
import { handleSystemLogsWebSocket } from "./system-logs-ws-handler";

describe("system logs WebSocket authentication", () => {
  const sandbox = sinon.createSandbox();
  const secret = "fictional-test-secret";
  const memberId = "aaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    clearSystemLogs();
    sandbox.stub(envConfig, "auth").returns({secret});
  });
  afterEach(() => sandbox.restore());

  it("rejects a missing token before sending buffered logs", async () => {
    const find = sandbox.stub(member, "findById");
    const send = sandbox.spy();
    const close = sandbox.spy();
    const ws = {readyState: WebSocket.OPEN, send, close, on: sandbox.spy()} as unknown as WebSocket;
    appendSystemLog("ngx-ramblers:test:server", "secret line");
    await handleSystemLogsWebSocket(ws, {}, null);
    expect(find.called).toBe(false);
    expect(JSON.parse(send.firstCall.args[0])).toEqual({type: MessageType.ERROR, data: {message: "Admin access required"}});
    expect(close.calledOnce).toBe(true);
  });

  it("rejects a signed-in member without admin access", async () => {
    sandbox.stub(member, "findById").resolves({
      toObject: () => ({_id: memberId, firstName: "Alex", lastName: "Reed", groupMember: true})
    });
    const send = sandbox.spy();
    const close = sandbox.spy();
    const ws = {readyState: WebSocket.OPEN, send, close, on: sandbox.spy()} as unknown as WebSocket;
    const token = jwt.sign({memberId}, secret, {expiresIn: 60});
    await handleSystemLogsWebSocket(ws, {}, token);
    expect(JSON.parse(send.firstCall.args[0]).type).toBe(MessageType.ERROR);
    expect(close.calledOnce).toBe(true);
  });

  it("sends the log snapshot to a member administrator", async () => {
    sandbox.stub(member, "findById").resolves({
      toObject: () => ({_id: memberId, firstName: "Alex", lastName: "Reed", groupMember: true, memberAdmin: true})
    });
    const send = sandbox.spy();
    const on = sandbox.spy();
    const ws = {readyState: WebSocket.OPEN, send, close: sandbox.spy(), on} as unknown as WebSocket;
    appendSystemLog("ngx-ramblers:test:server", "ready");
    const token = jwt.sign({memberId}, secret, {expiresIn: 60});
    await handleSystemLogsWebSocket(ws, {}, token);
    const first = JSON.parse(send.firstCall.args[0]);
    expect(first.type).toBe(MessageType.SYSTEM_LOG);
    expect(first.data.lines.map((line: {text: string}) => line.text)).toEqual(["ready"]);
    expect(on.calledWith("close")).toBe(true);
  });
});
