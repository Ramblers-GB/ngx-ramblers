import expect from "expect";
import sinon from "sinon";
import WebSocket from "ws";
import { EventEmitter } from "events";
import * as authentication from "../../auth/request-member";
import { batchSendJobs, observeBatchProgress, publishBatchProgress } from "./batch-send-progress";
import { handleBatchSendProgress } from "./batch-send-progress-ws-handler";
import { requireBatchSendOwner } from "./batch-send-progress-controllers";
import { BatchSendEntryStatus, BatchSendStatus } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";

describe("email send progress subscriptions", () => {
  const sandbox = sinon.createSandbox();
  const jobId = "fictional-send-job";
  const owner = "64b000000000000000000001";
  const socket = () => Object.assign(new EventEmitter(), {readyState: WebSocket.OPEN, bufferedAmount: 0, send: sandbox.spy(), close: sandbox.spy()});

  beforeEach(() => {
    sandbox.stub(authentication, "memberFromRequest").resolves({memberId: owner} as any);
    batchSendJobs.set(jobId, {
      jobId, requestedBy: owner, status: BatchSendStatus.RUNNING,
      totalRecipients: 8000, sentCount: 1, failedCount: 0, skippedCount: 0, startedAt: 1,
      entries: [{memberId: "member-1", fullName: "Alex Reed", email: "alex@example.com", status: BatchSendEntryStatus.Sent}]
    });
  });

  afterEach(() => {
    batchSendJobs.delete(jobId);
    sandbox.restore();
  });

  it("resumes the same job after disconnect without restarting delivery", async () => {
    const first = socket();
    await handleBatchSendProgress(first as unknown as WebSocket, {jobId}, "example-token");
    expect(JSON.parse(first.send.firstCall.args[0]).data.progress.sentCount).toBe(1);
    first.emit("close");
    batchSendJobs.get(jobId).sentCount = 4;
    const second = socket();
    await handleBatchSendProgress(second as unknown as WebSocket, {jobId}, "example-token");
    expect(JSON.parse(second.send.firstCall.args[0]).data.progress.sentCount).toBe(4);
    publishBatchProgress(jobId, batchSendJobs.get(jobId).entries[0]);
    expect(first.send.callCount).toBe(1);
    expect(second.send.callCount).toBe(2);
    expect(JSON.parse(second.send.secondCall.args[0]).data.progress.entries).toHaveLength(1);
    second.emit("close");
  });

  it("replaces duplicate subscriptions and stops sending updates after unsubscribe", async () => {
    const ws = socket();
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId}, "example-token");
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId}, "example-token");
    publishBatchProgress(jobId);
    expect(ws.send.callCount).toBe(3);
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId, unsubscribe: true}, "example-token");
    publishBatchProgress(jobId);
    expect(ws.send.callCount).toBe(3);
    ws.emit("close");
  });

  it("does not download 8000 pending recipients when watching a running job", async () => {
    batchSendJobs.get(jobId).entries = Array.from({length: 8000}, (_, index) => ({
      memberId: `member-${index}`, fullName: "Alex Reed", email: `alex.${index}@example.com`, status: BatchSendEntryStatus.Pending
    }));
    const ws = socket();
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId}, "example-token");
    const snapshot = JSON.parse(ws.send.firstCall.args[0]);
    expect(snapshot.data.progress.totalRecipients).toBe(8000);
    expect(snapshot.data.progress.entries).toEqual([]);
    expect(ws.send.firstCall.args[0].length).toBeLessThan(1000);
    ws.emit("close");
  });

  it("does not retain a subscription after the socket closes during authentication", async () => {
    const identity: {resolve: (person: any) => void} = {resolve: null};
    (authentication.memberFromRequest as sinon.SinonStub).returns(new Promise(resolve => identity.resolve = resolve));
    const ws = socket();
    const watching = handleBatchSendProgress(ws as unknown as WebSocket, {jobId}, "example-token");
    Object.assign(ws, {readyState: WebSocket.CLOSED});
    ws.emit("close");
    identity.resolve({memberId: owner});
    await watching;
    publishBatchProgress(jobId);
    expect(ws.send.called).toBe(false);
    expect(ws.listenerCount("close")).toBe(0);
  });

  it("keeps publishing when a disconnected observer throws", () => {
    const broken = observeBatchProgress(jobId, () => { throw new Error("Connection closed"); });
    const received = sandbox.spy();
    const healthy = observeBatchProgress(jobId, received);
    expect(() => publishBatchProgress(jobId)).not.toThrow();
    expect(received.calledOnce).toBe(true);
    broken();
    healthy();
  });

  it("protects another member's progress, status and cancellation", async () => {
    (authentication.memberFromRequest as sinon.SinonStub).resolves({memberId: "another-member"});
    const ws = socket();
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId}, "example-token");
    expect(JSON.parse(ws.send.firstCall.args[0]).data.error.status).toBe(403);
    const res = {status: sandbox.stub().returnsThis(), json: sandbox.spy()};
    const next = sandbox.spy();
    requireBatchSendOwner({params: {jobId}, user: {memberId: "another-member"}} as any, res as any, next);
    expect(res.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it("reports a missing job without creating or restarting it", async () => {
    const ws = socket();
    await handleBatchSendProgress(ws as unknown as WebSocket, {jobId: "missing-job"}, "example-token");
    expect(JSON.parse(ws.send.firstCall.args[0]).data.error.status).toBe(404);
    expect(batchSendJobs.has("missing-job")).toBe(false);
  });
});
