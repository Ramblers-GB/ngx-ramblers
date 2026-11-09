import debug from "debug";
import express, { Request, Response } from "express";
import mongoose from "mongoose";
import { postSignedWorkerBody, verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import {
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerResultStatus,
  IntegrationWorkerWalksManagerSyncJobRequest,
  IntegrationWorkerWalksManagerSyncProgressCallback,
  IntegrationWorkerWalksManagerSyncResult,
  IntegrationWorkerWalksManagerSyncResultCallback
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { integrationWorkerHeavyJobQueue } from "./integration-worker-heavy-job-queue";
import { IntegrationWorkerHeavyJobType } from "../models/integration-worker-heavy-job.model";
import { syncWalksManagerData } from "../walks/walks-manager-sync";
import { walksManagerSyncModelsFor } from "../walks/walks-manager-sync-models";

const debugLog = debug(envConfig.logNamespace("integration-worker-walks-manager-sync-routes"));
const router = express.Router();

async function postProgress(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, payload: IntegrationWorkerWalksManagerSyncProgressCallback): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.progressPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("progress callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function postResult(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, payload: IntegrationWorkerWalksManagerSyncResultCallback): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.resultPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("result callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function runWalksManagerSync(request: IntegrationWorkerWalksManagerSyncJobRequest): Promise<void> {
  const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
  const reviewSite = mongoose.createConnection(request.mongoUri);
  let errorMessage: string | null = null;
  let result: IntegrationWorkerWalksManagerSyncResult | null = null;
  try {
    await reviewSite.asPromise();
    const sync = await syncWalksManagerData(request.systemConfig, {
      fullSync: request.fullSync,
      onProgress: (percent, message) => {
        void postProgress(request.callback, sharedSecret, {jobId: request.jobId, percent, message});
      }
    }, null, walksManagerSyncModelsFor(reviewSite));
    if (sync.errors.length) {
      errorMessage = `Walks Manager load finished with errors: ${sync.errors.join("; ")}`;
    } else {
      result = {
        added: sync.added,
        updated: sync.updated,
        deleted: sync.deleted,
        totalProcessed: sync.totalProcessed,
        errors: sync.errors
      };
    }
  } catch (error) {
    errorMessage = (error as Error)?.message || "Walks Manager sync failed";
    debugLog("walks manager sync failed jobId:", request.jobId, "error:", errorMessage);
  } finally {
    await reviewSite.close();
  }
  await postResult(request.callback, sharedSecret, {
    jobId: request.jobId,
    status: errorMessage ? IntegrationWorkerResultStatus.Error : IntegrationWorkerResultStatus.Success,
    result: result || undefined,
    errorMessage: errorMessage || undefined
  });
}

router.post("/jobs", async (req: Request, res: Response) => {
  const request = req.body as IntegrationWorkerWalksManagerSyncJobRequest;
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker request signature"});
  } else if (!request?.jobId || !request?.mongoUri || !request?.systemConfig || !request?.callback) {
    res.status(400).json({error: "jobId, mongoUri, systemConfig and callback are required"});
  } else {
    const queueResult = integrationWorkerHeavyJobQueue.enqueue({
      jobId: request.jobId,
      type: IntegrationWorkerHeavyJobType.WalksManagerSync,
      label: `${request.environmentName} Walks Manager sync`,
      run: () => runWalksManagerSync(request)
    });
    debugLog("POST /walks-manager-sync/jobs jobId:", request.jobId, "queued:", queueResult.queued, "queuePosition:", queueResult.queuePosition);
    res.json({accepted: true, jobId: request.jobId, queued: queueResult.queued, queuePosition: queueResult.queuePosition});
  }
});

export const integrationWorkerWalksManagerSyncRoutes = router;
