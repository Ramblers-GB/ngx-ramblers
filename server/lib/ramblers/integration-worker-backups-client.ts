import { randomUUID } from "crypto";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { encryptRamblersUploadPayload, signedJsonPost } from "./integration-worker-crypto";
import {
  IntegrationWorkerBackupOptions,
  IntegrationWorkerBackupsJobRequest,
  IntegrationWorkerBackupsResultCallback,
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerResultStatus
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";
import { backupsWorkerSession, completeBackupsWorkerSession, registerBackupsWorkerSession } from "../backup/backups-worker-session";
import { dateTimeNowAsValue } from "../shared/dates";
import { startIntegrationWorkerKeepAlive } from "./integration-worker-browser-client";

const debugLog = debug(envConfig.logNamespace("integration-worker-backups-client"));
debugLog.enabled = true;

const wholeJobTimeoutMs = 4 * 60 * 60 * 1000;
const delay = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

function required(key: Environment): string {
  const value = envConfig.value(key);
  if (!value) {
    throw new Error(`Environment variable '${key}' must be set to submit backup jobs to the integration worker`);
  } else {
    return value;
  }
}

export function integrationWorkerBackupsAvailable(): boolean {
  return Boolean(envConfig.value(Environment.INTEGRATION_WORKER_URL) && envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) && envConfig.value(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY));
}

function backupCallback(): IntegrationWorkerCallbackConfig {
  const callbackBaseUrl = envConfig.value(Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL) || envConfig.value(Environment.BASE_URL);
  if (!callbackBaseUrl) {
    throw new Error(`Environment variable '${Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL}' or '${Environment.BASE_URL}' must be set to submit backup jobs`);
  } else {
    return {
      baseUrl: callbackBaseUrl,
      progressPath: "/api/integration-worker/backups/progress",
      resultPath: "/api/integration-worker/backups/result"
    };
  }
}

async function postBackupJob(request: IntegrationWorkerBackupsJobRequest): Promise<void> {
  const workerUrl = required(Environment.INTEGRATION_WORKER_URL);
  const sharedSecret = required(Environment.INTEGRATION_WORKER_SHARED_SECRET);
  const endpoint = `${stripTrailingSlash(workerUrl)}/api/integration-worker/backups/jobs`;
  debugLog("-> submit backups jobId:", request.jobId, "endpoint:", endpoint, "environment:", request.options?.environment || "all");
  const response = await signedJsonPost(endpoint, sharedSecret, request);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Integration worker backup submit failed with status ${response.status}: ${text}`);
  }
}

export async function submitEnvironmentBackupToIntegrationWorker(sessionMongoId: string, options: IntegrationWorkerBackupOptions): Promise<void> {
  const encryptionKey = required(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY);
  const mongoUri = envConfig.mongo()?.uri;
  if (!mongoUri) {
    throw new Error("Mongo URI must be configured to run backups on the integration worker");
  } else {
    await postBackupJob({
      jobId: randomUUID(),
      encryptedMongoUri: encryptRamblersUploadPayload({uri: mongoUri}, encryptionKey),
      callback: backupCallback(),
      sessionMongoId,
      options
    });
  }
}

async function waitForBackupResult(jobId: string, startedAt: number): Promise<IntegrationWorkerBackupsResultCallback> {
  const state: { result: IntegrationWorkerBackupsResultCallback | null } = {result: null};
  registerBackupsWorkerSession({
    jobId,
    onProgress: body => {
      debugLog("worker backup progress jobId:", jobId, body.message);
    },
    onResult: body => {
      state.result = body;
    }
  });
  const poll = async (): Promise<IntegrationWorkerBackupsResultCallback> => {
    if (state.result) {
      return state.result;
    } else if (dateTimeNowAsValue() - startedAt >= wholeJobTimeoutMs) {
      throw new Error(`Timed out waiting for integration worker backup job ${jobId}`);
    } else {
      await delay(5000);
      return poll();
    }
  };
  return poll();
}

export async function runAllEnvironmentsBackupOnIntegrationWorker(): Promise<void> {
  const encryptionKey = required(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY);
  const mongoUri = envConfig.mongo()?.uri;
  if (!mongoUri) {
    throw new Error("Mongo URI must be configured to run backups on the integration worker");
  } else {
    const jobId = randomUUID();
    const request: IntegrationWorkerBackupsJobRequest = {
      jobId,
      encryptedMongoUri: encryptRamblersUploadPayload({uri: mongoUri}, encryptionKey),
      callback: backupCallback()
    };
    const stopKeepAlive = startIntegrationWorkerKeepAlive();
    const startedAt = dateTimeNowAsValue();
    const waiting = waitForBackupResult(jobId, startedAt);
    const submitError: {value: Error | null} = {value: null};
    try {
      try {
        await postBackupJob(request);
      } catch (error) {
        submitError.value = error instanceof Error ? error : new Error(`${error}`);
      }
      if (submitError.value) {
        backupsWorkerSession(jobId)?.onResult({
          jobId,
          status: IntegrationWorkerResultStatus.Error,
          errorMessage: submitError.value.message
        });
      }
      const result = await waiting;
      if (submitError.value) {
        throw submitError.value;
      } else if (result.status === IntegrationWorkerResultStatus.Error) {
        throw new Error(result.errorMessage || "Integration worker backup failed");
      }
    } finally {
      stopKeepAlive();
      completeBackupsWorkerSession(jobId);
    }
  }
}
