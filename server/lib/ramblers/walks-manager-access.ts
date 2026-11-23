import { Request, Response } from "express";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { WalksManagerAccess, WalksManagerAccessRequest, WalksManagerAccessStatus } from "../../../projects/ngx-ramblers/src/app/models/walks-manager-access.model";
import { IntegrationWorkerJobResponse } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { walksManagerAccessWithStatus } from "../../../projects/ngx-ramblers/src/app/functions/walks/walks-manager-access";
import { buildWalksManagerAccessJob } from "./os-maps-export-job-builder";
import { detachedAuditSocket, dispatchRemoteIntegrationWorkerJob, integrationWorkerConfigured } from "./dispatch-integration-worker-job";
import { applyWalksManagerAccessWorkerResult, createQueuedWalksManagerAccessResult, walksManagerAccessResultByJobId } from "./walks-manager-access-store";
import { secretOrSaved } from "../shared/mask-secrets";
import { systemConfig } from "../config/system-config";

const debugLog = debug(envConfig.logNamespace("walks-manager-access"));

export async function startWalksManagerAccessCheck(userName: string, password: string): Promise<IntegrationWorkerJobResponse> {
  if (!userName || !password) {
    throw new Error("Enter both the Walks Manager user name and password first");
  } else if (!integrationWorkerConfigured()) {
    throw new Error("No integration worker is configured to log in to Walks Manager");
  } else {
    const job = buildWalksManagerAccessJob();
    await createQueuedWalksManagerAccessResult(job.jobId);
    try {
      return await dispatchRemoteIntegrationWorkerJob(job, {userName, password}, detachedAuditSocket());
    } catch (error) {
      debugLog("startWalksManagerAccessCheck failed:", (error as Error).message);
      await applyWalksManagerAccessWorkerResult(job.jobId, undefined, (error as Error).message);
      throw error;
    }
  }
}

export async function walksManagerAccessForJob(jobId: string): Promise<WalksManagerAccess> {
  const result = await walksManagerAccessResultByJobId(jobId);
  return result ? {status: result.status, message: result.message} : walksManagerAccessWithStatus(WalksManagerAccessStatus.NOT_CHECKED, "no check was found for this job");
}

export async function startWalksManagerAccessCheckHandler(req: Request, res: Response): Promise<void> {
  const request = req.body as WalksManagerAccessRequest;
  const userName = (request?.userName || "").trim();
  const saved = (await systemConfig())?.national?.walksManager;
  const savedPassword = userName === (saved?.userName || "").trim() ? saved?.password : null;
  try {
    res.json(await startWalksManagerAccessCheck(userName, secretOrSaved(request?.password || "", savedPassword)));
  } catch (error) {
    res.status(400).json({message: (error as Error).message});
  }
}

export async function walksManagerAccessHandler(req: Request, res: Response): Promise<void> {
  res.json(await walksManagerAccessForJob(req.params.jobId));
}
