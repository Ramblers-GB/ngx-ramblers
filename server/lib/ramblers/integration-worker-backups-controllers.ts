import debug from "debug";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { decryptRamblersUploadPayload, postSignedWorkerBody, verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import {
  IntegrationWorkerBackupsJobRequest,
  IntegrationWorkerBackupsProgressCallback,
  IntegrationWorkerBackupsResultCallback,
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerResultStatus
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { integrationWorkerHeavyJobQueue } from "./integration-worker-heavy-job-queue";
import { IntegrationWorkerHeavyJobType } from "../models/integration-worker-heavy-job.model";
import { backupAllEnvironments } from "../cron/backups-run";
import { createBackupAndRestoreService } from "../backup/backup-service-factory";
import { backupEvents, BackupEventMap } from "../backup/backup-events";
import { isString } from "es-toolkit/compat";

const debugLog = debug(envConfig.logNamespace("integration-worker-backups-controllers"));
debugLog.enabled = true;

function requiredValue(environmentVariable: Environment): string {
  const value = envConfig.value(environmentVariable);
  if (!value) {
    throw new Error(`Environment variable '${environmentVariable}' must be set`);
  } else {
    return value;
  }
}

async function postProgress(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, payload: IntegrationWorkerBackupsProgressCallback): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.progressPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("progress callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function postResult(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, payload: IntegrationWorkerBackupsResultCallback): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.resultPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("result callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}

async function runBackups(request: IntegrationWorkerBackupsJobRequest): Promise<void> {
  const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
  const onSessionUpdated = ({session}: BackupEventMap["session-updated"]) => {
    const sessionMongoId = session._id?.toString();
    if (sessionMongoId && (!request.sessionMongoId || request.sessionMongoId === sessionMongoId)) {
      void postProgress(request.callback, sharedSecret, {
        jobId: request.jobId,
        message: session.status,
        sessionMongoId
      });
    }
  };
  try {
    const payload = decryptRamblersUploadPayload<{uri: string}>(
      request.encryptedMongoUri,
      requiredValue(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY)
    );
    if (!payload?.uri) {
      throw new Error("encryptedMongoUri did not contain a uri");
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    await mongoose.connect(payload.uri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 300000,
      connectTimeoutMS: 30000
    });
    backupEvents.on("session-updated", onSessionUpdated);
    if (request.sessionMongoId && request.options) {
      const service = await createBackupAndRestoreService();
      await service.executeQueuedBackup(request.sessionMongoId, request.options);
    } else {
      await backupAllEnvironments({holdWatchdog: false});
    }
    await postResult(request.callback, sharedSecret, {
      jobId: request.jobId,
      status: IntegrationWorkerResultStatus.Success
    });
  } catch (error) {
    const errorMessage = (error as Error)?.message || "Backup failed";
    debugLog("backups failed jobId:", request.jobId, "error:", errorMessage);
    await postResult(request.callback, sharedSecret, {
      jobId: request.jobId,
      sessionMongoId: request.sessionMongoId,
      status: IntegrationWorkerResultStatus.Error,
      errorMessage
    });
  } finally {
    backupEvents.off("session-updated", onSessionUpdated);
    await mongoose.connection.close();
  }
}

export async function submitBackupsJob(req: Request, res: Response): Promise<void> {
  const request = req.body as IntegrationWorkerBackupsJobRequest;
  const activeJob = integrationWorkerHeavyJobQueue.activeJob();
  debugLog("POST /backups/jobs received: jobId:", request?.jobId, "activeJobId:", activeJob?.jobId, "activeJobType:", activeJob?.type);
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker request signature"});
  } else if (!request?.jobId || !request?.encryptedMongoUri || !request?.callback) {
    res.status(400).json({error: "jobId, encryptedMongoUri and callback are required"});
  } else if (Boolean(request.sessionMongoId) !== Boolean(request.options?.environment)) {
    res.status(400).json({error: "A manual backup requires a session ID and an environment"});
  } else {
    const queueResult = integrationWorkerHeavyJobQueue.enqueue({
      jobId: request.jobId,
      type: IntegrationWorkerHeavyJobType.Backups,
      label: request.options?.environment ? `Backup ${request.options.environment}` : "All-environments backup",
      run: () => runBackups(request)
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

export async function cancelBackupsJob(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker request signature"});
  } else {
    const jobId = isString(req.params.jobId) ? req.params.jobId : "";
    const removed = integrationWorkerHeavyJobQueue.removeQueued(jobId);
    res.json({cancelled: removed});
  }
}
