import expect from "expect";
import { describe, it } from "mocha";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { walksManagerAccessFromJobPath } from "./walks-manager-access-store";
import { awaitWorkerResult } from "./await-worker-result";
import { buildWalksManagerAccessJob } from "./os-maps-export-job-builder";
import { WALKS_MANAGER_ACCESS_FILE, WalksManagerAccessStatus } from "../../../projects/ngx-ramblers/src/app/models/walks-manager-access.model";
import { SerenityFeature } from "../../../projects/ngx-ramblers/src/app/models/serenity-feature.model";
import { dateTimeNowAsValue } from "../shared/dates";

describe("walks-manager-access-store", () => {

  it("reads the access the worker wrote into the job folder", () => {
    const jobPath = fs.mkdtempSync(path.join(os.tmpdir(), "walks-manager-access-"));
    fs.writeFileSync(path.join(jobPath, WALKS_MANAGER_ACCESS_FILE), JSON.stringify({status: WalksManagerAccessStatus.NO_UPLOAD_ACCESS}));
    const access = walksManagerAccessFromJobPath(jobPath);
    expect(access?.status).toEqual(WalksManagerAccessStatus.NO_UPLOAD_ACCESS);
    expect(access?.message).toContain("cannot upload walks");
    fs.rmSync(jobPath, {recursive: true, force: true});
  });

  it("returns nothing when the worker wrote no result", () => {
    expect(walksManagerAccessFromJobPath(path.join(os.tmpdir(), "no-such-walks-manager-job"))).toBeUndefined();
  });

  it("names the job file after the walks manager access feature", () => {
    const job = buildWalksManagerAccessJob();
    expect(job.data.feature).toEqual(SerenityFeature.WALKS_MANAGER_ACCESS);
    expect(job.data.fileName).toMatch(/^walks-manager-access-\d{8}-\d{6}\.json$/);
  });

  it("waits until the worker result is no longer queued", async () => {
    const answers = [WalksManagerAccessStatus.QUEUED, WalksManagerAccessStatus.QUEUED, WalksManagerAccessStatus.UPLOAD_AVAILABLE];
    const read = () => Promise.resolve({status: answers.shift()});
    const result = await awaitWorkerResult(read, found => found.status !== WalksManagerAccessStatus.QUEUED, dateTimeNowAsValue() + 1000, 1);
    expect(result?.status).toEqual(WalksManagerAccessStatus.UPLOAD_AVAILABLE);
  });
});
