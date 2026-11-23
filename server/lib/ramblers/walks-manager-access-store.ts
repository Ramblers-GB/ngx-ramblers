import * as fs from "fs";
import * as path from "path";
import { dateTimeNowAsValue } from "../shared/dates";
import * as mongooseClient from "../mongo/mongoose-client";
import { walksManagerAccessResult } from "../mongo/models/walks-manager-access-result";
import {
  WALKS_MANAGER_ACCESS_FILE,
  WALKS_MANAGER_ACCESS_MESSAGES,
  WalksManagerAccess,
  WalksManagerAccessJobResult,
  WalksManagerAccessStatus
} from "../../../projects/ngx-ramblers/src/app/models/walks-manager-access.model";
import { walksManagerAccessWithStatus } from "../../../projects/ngx-ramblers/src/app/functions/walks/walks-manager-access";

export function walksManagerAccessFromJobPath(jobPath?: string): WalksManagerAccess | undefined {
  const accessPath = jobPath ? path.join(jobPath, WALKS_MANAGER_ACCESS_FILE) : null;
  if (!accessPath || !fs.existsSync(accessPath)) {
    return undefined;
  } else {
    const parsed = JSON.parse(fs.readFileSync(accessPath, "utf8"));
    return parsed?.status ? {status: parsed.status, message: parsed.message || WALKS_MANAGER_ACCESS_MESSAGES[parsed.status as WalksManagerAccessStatus] || ""} : undefined;
  }
}

export async function createQueuedWalksManagerAccessResult(jobId: string): Promise<void> {
  await mongooseClient.execute(() => walksManagerAccessResult.updateOne(
    {jobId},
    {jobId, ...walksManagerAccessWithStatus(WalksManagerAccessStatus.QUEUED), createdAt: dateTimeNowAsValue(), completedAt: null},
    {upsert: true}
  ));
}

export async function applyWalksManagerAccessWorkerResult(jobId: string, access: WalksManagerAccess | undefined, errorMessage?: string): Promise<boolean> {
  const outcome = access || walksManagerAccessWithStatus(WalksManagerAccessStatus.NOT_CHECKED, errorMessage || "the check did not finish");
  const result = await mongooseClient.execute(() => walksManagerAccessResult.updateOne(
    {jobId, status: WalksManagerAccessStatus.QUEUED},
    {$set: {status: outcome.status, message: outcome.message, completedAt: dateTimeNowAsValue()}}
  ));
  return result.matchedCount > 0;
}

export async function walksManagerAccessResultByJobId(jobId: string): Promise<WalksManagerAccessJobResult | null> {
  return mongooseClient.execute(() => walksManagerAccessResult.findOne({jobId}).lean<WalksManagerAccessJobResult>().exec());
}
