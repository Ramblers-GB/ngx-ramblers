import expect from "expect";
import { describe, it } from "mocha";
import { IntegrationWorkerResultStatus } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import {
  backupsWorkerSession,
  completeBackupsWorkerSession,
  registerBackupsWorkerSession
} from "./backups-worker-session";

describe("backups worker session", () => {
  it("stores and completes a waiting session", () => {
    const received: string[] = [];
    registerBackupsWorkerSession({
      jobId: "example-job",
      onProgress: body => received.push(body.message),
      onResult: body => received.push(body.status)
    });
    const session = backupsWorkerSession("example-job");
    expect(!!session).toEqual(true);
    session?.onProgress({jobId: "example-job", message: "queued"});
    session?.onResult({jobId: "example-job", status: IntegrationWorkerResultStatus.Success});
    completeBackupsWorkerSession("example-job");
    expect(backupsWorkerSession("example-job")).toEqual(null);
    expect(received).toEqual(["queued", IntegrationWorkerResultStatus.Success]);
  });
});
