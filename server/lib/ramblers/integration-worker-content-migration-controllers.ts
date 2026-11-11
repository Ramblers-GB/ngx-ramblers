import debug from "debug";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { S3 } from "@aws-sdk/client-s3";
import { isString } from "es-toolkit/compat";
import { decryptRamblersUploadPayload, postSignedWorkerBody, verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import {
  IntegrationWorkerAwsCredentials,
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerContentMigrationJobRequest,
  IntegrationWorkerContentMigrationProgressCallback,
  IntegrationWorkerContentMigrationResultCallback,
  IntegrationWorkerResultStatus
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { integrationWorkerHeavyJobQueue } from "./integration-worker-heavy-job-queue";
import { IntegrationWorkerHeavyJobType } from "../models/integration-worker-heavy-job.model";
import { migrateContent } from "../image-migration/image-migration-engine";
import { contentMigrationModelsFor } from "../image-migration/content-migration-models";

const debugLog = debug(envConfig.logNamespace("integration-worker-content-migration-controllers"));
debugLog.enabled = true;

const cancelledJobIds = new Set<string>();
const submittedJobs = new Map<string, IntegrationWorkerContentMigrationJobRequest>();

function requiredValue(environmentVariable: Environment): string {
  const value = envConfig.value(environmentVariable);
  if (!value) {
    throw new Error(`Environment variable '${environmentVariable}' must be set`);
  } else {
    return value;
  }
}

async function postProgress(
  callback: IntegrationWorkerCallbackConfig,
  sharedSecret: string,
  payload: IntegrationWorkerContentMigrationProgressCallback
): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.progressPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("progress callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function postResult(
  callback: IntegrationWorkerCallbackConfig,
  sharedSecret: string,
  payload: IntegrationWorkerContentMigrationResultCallback
): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.resultPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("result callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function runContentMigration(request: IntegrationWorkerContentMigrationJobRequest): Promise<void> {
  const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
  const credentials = decryptRamblersUploadPayload<IntegrationWorkerAwsCredentials>(
    request.encryptedAwsCredentials,
    requiredValue(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY)
  );
  const s3 = new S3({
    region: request.awsConfig.region,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey }
  });
  const site = mongoose.createConnection(request.mongoUri);
  try {
    await site.asPromise();
    const result = await migrateContent(
      request.migrationRequest,
      progress => {
        void postProgress(request.callback, sharedSecret, {
          jobId: request.jobId,
          message: progress.currentItem,
          progress
        });
      },
      () => cancelledJobIds.has(request.jobId),
      {
        s3Target: { client: s3, bucket: request.awsConfig.bucket },
        models: contentMigrationModelsFor(site)
      }
    );
    cancelledJobIds.delete(request.jobId);
    submittedJobs.delete(request.jobId);
    if (result.cancelled) {
      await postResult(request.callback, sharedSecret, {
        jobId: request.jobId,
        status: IntegrationWorkerResultStatus.Success,
        result,
        cancelled: true
      });
    } else {
      await postResult(request.callback, sharedSecret, {
        jobId: request.jobId,
        status: IntegrationWorkerResultStatus.Success,
        result
      });
    }
  } catch (error) {
    cancelledJobIds.delete(request.jobId);
    submittedJobs.delete(request.jobId);
    const errorMessage = (error as Error)?.message || "Content migration failed";
    debugLog("content migration failed jobId:", request.jobId, "error:", errorMessage);
    await postResult(request.callback, sharedSecret, {
      jobId: request.jobId,
      status: IntegrationWorkerResultStatus.Error,
      errorMessage
    });
  } finally {
    await site.close();
  }
}

export async function submitContentMigrationJob(req: Request, res: Response): Promise<void> {
  const request = req.body as IntegrationWorkerContentMigrationJobRequest;
  const activeJob = integrationWorkerHeavyJobQueue.activeJob();
  debugLog("POST /content-migration/jobs received: jobId:", request?.jobId, "activeJobId:", activeJob?.jobId, "activeJobType:", activeJob?.type);
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({ error: "Invalid integration worker request signature" });
  } else if (!request?.jobId || !request?.migrationRequest || !request?.mongoUri || !request?.awsConfig || !request?.encryptedAwsCredentials || !request?.callback) {
    res.status(400).json({ error: "jobId, migrationRequest, mongoUri, awsConfig, encryptedAwsCredentials and callback are required" });
  } else {
    cancelledJobIds.delete(request.jobId);
    submittedJobs.set(request.jobId, request);
    const queueResult = integrationWorkerHeavyJobQueue.enqueue({
      jobId: request.jobId,
      type: IntegrationWorkerHeavyJobType.ContentMigration,
      label: `Content Migration (${request.migrationRequest.items?.length || 0} items)`,
      run: () => runContentMigration(request)
    });
    debugLog("queued: jobId:", request.jobId, "queued:", queueResult.queued, "position:", queueResult.queuePosition);
    if (queueResult.queued) {
      const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
      void postProgress(request.callback, sharedSecret, {
        jobId: request.jobId,
        message: `Queued at position ${queueResult.queuePosition}; waiting for the current ${queueResult.activeJobType} job`,
        queued: true,
        queuePosition: queueResult.queuePosition,
        activeJobType: queueResult.activeJobType || undefined
      });
    }
    res.json({
      accepted: true,
      jobId: request.jobId,
      queued: queueResult.queued,
      queuePosition: queueResult.queuePosition,
      activeJobId: queueResult.activeJobId
    });
  }
}

export async function cancelContentMigrationJob(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({ error: "Invalid integration worker request signature" });
  } else {
    const jobId = isString(req.params.jobId) ? req.params.jobId : "";
    const activeJob = integrationWorkerHeavyJobQueue.activeJob();
    if (integrationWorkerHeavyJobQueue.removeQueued(jobId)) {
      debugLog("queued content migration job removed jobId:", jobId);
      const queued = submittedJobs.get(jobId);
      submittedJobs.delete(jobId);
      if (queued) {
        const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
        void postResult(queued.callback, sharedSecret, {
          jobId,
          status: IntegrationWorkerResultStatus.Success,
          cancelled: true,
          result: { totalProcessed: 0, successCount: 0, failureCount: 0, migratedItems: [], failedItems: [], cancelled: true }
        });
      }
      res.json({ cancelled: true });
    } else if (activeJob?.type === IntegrationWorkerHeavyJobType.ContentMigration && activeJob.jobId === jobId) {
      cancelledJobIds.add(jobId);
      debugLog("content migration cancel requested jobId:", jobId);
      res.json({ cancelled: true });
    } else {
      res.json({ cancelled: false, activeJobId: activeJob?.jobId || null });
    }
  }
}
