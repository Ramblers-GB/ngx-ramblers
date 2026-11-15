import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BackupAndRestoreService } from "./backup-and-restore-service";
import { backupEvents } from "./backup-events";
import { backupSession } from "../mongo/models/backup-session";
import { BackupSessionStatus } from "../../../projects/ngx-ramblers/src/app/models/backup-session.model";

describe("backup database traffic", () => {
  const sandbox = sinon.createSandbox();
  const service = new BackupAndRestoreService([], {});

  afterEach(() => sandbox.restore());

  it("uses the selected archive for restore and deletion", async () => {
    const service = new BackupAndRestoreService([], {
      environments: [{environment: "group-example"}],
      aws: {
        bucket: "archive-current", region: "eu-west-2", accessKeyId: "current-key", secretAccessKey: "current-secret",
        previous: {bucket: "archive-previous", region: "eu-west-1", accessKeyId: "previous-key", secretAccessKey: "previous-secret"}
      }
    });
    const prefix = "group-example/2026-11-15-20-00-00";
    const location = `s3://archive-previous/${prefix}`;
    const {client} = service["archiveBackupAt"](location);
    expect(await client.config.region()).toEqual("eu-west-1");
    expect((await client.config.credentials()).accessKeyId).toEqual("previous-key");
    const send = sandbox.stub(S3Client.prototype, "send");
    send.onFirstCall().resolves({Contents: [{Key: `${prefix}/dump.bson`}]});
    send.onSecondCall().resolves({});
    const result = await service.deleteS3Backups([location, prefix, `s3://archive-unknown/${prefix}`]);
    expect(result.deleted).toEqual([location]);
    expect(result.errors).toHaveLength(2);
    expect(send.callCount).toBe(2);
    expect((send.firstCall.args[0] as ListObjectsV2Command).input).toMatchObject({Bucket: "archive-previous", Prefix: `${prefix}/`});
    expect((send.secondCall.args[0] as DeleteObjectCommand).input).toEqual({Bucket: "archive-previous", Key: `${prefix}/dump.bson`});
  });

  it("requests network compression alongside the existing connection timeouts", () => {
    const uri = service["buildMongoUriForConfig"]("cluster.example", "backup-user", "example-password", "group-example");
    const options = new URLSearchParams(uri.split("?")[1]);

    expect(options.get("compressors")).toEqual("zlib");
    expect(options.get("socketTimeoutMS")).toEqual("300000");
    expect(options.get("connectTimeoutMS")).toEqual("30000");
    expect(options.get("serverSelectionTimeoutMS")).toEqual("30000");
  });

  it("lists history without modifying sessions or reconciling interrupted runs", async () => {
    const records = [{status: BackupSessionStatus.IN_PROGRESS}];
    const lean = sandbox.stub().resolves(records);
    const select = sandbox.stub().returns({lean});
    const limit = sandbox.stub().returns({select});
    const sort = sandbox.stub().returns({limit});
    const find = sandbox.stub(backupSession, "find").returns({sort} as any);
    const updateOne = sandbox.stub(backupSession, "updateOne");
    const cleanup = sandbox.stub(service, "cleanupStuckSessions");

    expect(await service.sessions(20, ["group-example"])).toEqual(records);
    expect(find.calledOnceWithExactly({environment: {$in: ["group-example"]}})).toEqual(true);
    expect(cleanup.called).toEqual(false);
    expect(updateOne.called).toEqual(false);
  });

  it("polls only status and error without transferring the accumulated logs", async () => {
    const result = { status: BackupSessionStatus.IN_PROGRESS };
    const lean = sandbox.stub().resolves(result);
    const select = sandbox.stub().returns({ lean });
    const findById = sandbox.stub(backupSession, "findById").returns({ select } as any);

    expect(await service.sessionStatus("example-session")).toEqual(result);
    expect(findById.calledOnceWithExactly("example-session")).toEqual(true);
    expect(select.calledOnceWithExactly({ status: 1, error: 1, _id: 0 })).toEqual(true);
  });

  it("does not reread the full session when nobody is watching backup progress", async () => {
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    const findById = sandbox.stub(backupSession, "findById");

    await service["emitSessionUpdated"]("example-session");

    expect(findById.called).toEqual(false);
  });

  it("applies the same bounded history to individual upload progress lines", async () => {
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    const update = sandbox.stub(backupSession, "updateOne").resolves({} as any);
    await service["addLog"]("example-session", "Uploaded one dump file");
    expect(update.firstCall.args).toEqual([
      {_id: "example-session"},
      {$push: {logs: {$each: ["Uploaded one dump file"], $slice: -200}}, $currentDate: {updatedAt: true}}
    ]);
  });

  it("does not start a queued backup that was aborted while it waited its turn", async () => {
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    const update = sandbox.stub(backupSession, "updateOne").resolves({modifiedCount: 0} as any);
    const runBackup = sandbox.stub(service as any, "runBackup").resolves();
    await service["executeBackup"]("example-session", {} as any, {environment: "group-example"} as any, "example-backup");
    expect(update.firstCall.args[0]).toEqual({_id: "example-session", status: BackupSessionStatus.PENDING});
    expect(runBackup.called).toEqual(false);
  });

  it("starts a queued backup that is still pending", async () => {
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    sandbox.stub(backupSession, "updateOne").resolves({modifiedCount: 1} as any);
    const runBackup = sandbox.stub(service as any, "runBackup").resolves();
    await service["executeBackup"]("example-session", {} as any, {environment: "group-example"} as any, "example-backup");
    expect(runBackup.calledOnce).toEqual(true);
  });

  it("aborts a queued session", async () => {
    const update = sandbox.stub(backupSession, "updateOne").resolves({modifiedCount: 1} as any);
    sandbox.stub(backupSession, "findById").returns({select: () => ({lean: () => Promise.resolve({_id: "example-session", status: BackupSessionStatus.ABORTED})})} as any);
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    expect(await service.abortSession("example-session", "Alex Reed")).toEqual({_id: "example-session", status: BackupSessionStatus.ABORTED});
    expect(update.firstCall.args[0]).toEqual({_id: "example-session", status: BackupSessionStatus.PENDING});
  });

  it("aborts a running session when it is no longer queued", async () => {
    const update = sandbox.stub(backupSession, "updateOne")
      .onFirstCall().resolves({modifiedCount: 0} as any)
      .onSecondCall().resolves({modifiedCount: 1} as any);
    sandbox.stub(backupSession, "findById").returns({
      select: () => ({lean: () => Promise.resolve({_id: "example-session", status: BackupSessionStatus.ABORTED})}),
      lean: () => Promise.resolve({_id: "example-session", status: BackupSessionStatus.ABORTED, s3Location: null})
    } as any);
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    expect(await service.abortSession("example-session", "Alex Reed")).toEqual({_id: "example-session", status: BackupSessionStatus.ABORTED});
    expect(update.secondCall.args[0]).toEqual({_id: "example-session", status: BackupSessionStatus.IN_PROGRESS});
  });

  it("does not abort a finished session", async () => {
    const update = sandbox.stub(backupSession, "updateOne").resolves({modifiedCount: 0} as any);
    expect(await service.abortSession("example-session", "Alex Reed")).toBeNull();
    expect(update.firstCall.args[0]).toEqual({_id: "example-session", status: BackupSessionStatus.PENDING});
    expect(update.secondCall.args[0]).toEqual({_id: "example-session", status: BackupSessionStatus.IN_PROGRESS});
  });

  it("leaves an aborted session aborted when the run later completes or fails", async () => {
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    const update = sandbox.stub(backupSession, "updateOne").resolves({modifiedCount: 0} as any);
    await service["updateSession"]("example-session", {status: BackupSessionStatus.COMPLETED});
    await service["updateSessionError"]("example-session", "Dump failed");
    expect(update.firstCall.args[0]).toEqual({_id: "example-session", status: {$ne: BackupSessionStatus.ABORTED}});
    expect(update.secondCall.args[0]).toEqual({_id: "example-session", status: {$ne: BackupSessionStatus.ABORTED}});
  });

  it("deletes the local dump directory after an uploaded backup", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "ngx-ramblers-dump-"));
    await fs.writeFile(path.join(outDir, "chunk.bson.gz"), "example");
    sandbox.stub(backupEvents, "listenerCount").returns(0);
    sandbox.stub(backupSession, "updateOne").resolves({} as any);
    await service["removeLocalDump"](outDir, "example-session");
    const stillPresent = await fs.access(outDir).then(() => true).catch(() => false);
    expect(stillPresent).toEqual(false);
  });

  it("continues to publish full progress to a connected observer", async () => {
    const session = { status: BackupSessionStatus.IN_PROGRESS, logs: ["Dump started"] };
    sandbox.stub(backupEvents, "listenerCount").returns(1);
    const lean = sandbox.stub().resolves(session);
    const select = sandbox.stub().returns({ lean });
    sandbox.stub(backupSession, "findById").returns({ select } as any);
    const emit = sandbox.stub(backupEvents, "emit");

    await service["emitSessionUpdated"]("example-session");

    expect(select.calledOnceWithExactly({ logs: { $slice: -200 } })).toEqual(true);
    expect(emit.calledOnceWithExactly("session-updated", { session })).toEqual(true);
  });
});
