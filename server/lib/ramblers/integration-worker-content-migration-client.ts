import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { encryptRamblersUploadPayload, signedJsonPost } from "./integration-worker-crypto";
import {
  IntegrationWorkerAwsCredentials,
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerContentMigrationJobRequest
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { ContentMigrationRequest } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("integration-worker-content-migration-client"));
debugLog.enabled = true;

function required(key: Environment): string {
  const value = envConfig.value(key);
  if (!value) {
    throw new Error(`Environment variable '${key}' must be set to call the integration worker content-migration API`);
  } else {
    return value;
  }
}

export async function submitContentMigrationJobToIntegrationWorker(jobId: string, migrationRequest: ContentMigrationRequest): Promise<void> {
  const workerUrl = required(Environment.INTEGRATION_WORKER_URL);
  const sharedSecret = required(Environment.INTEGRATION_WORKER_SHARED_SECRET);
  const encryptionKey = required(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY);
  const callbackBaseUrl = envConfig.value(Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL) || envConfig.value(Environment.BASE_URL);
  if (!callbackBaseUrl) {
    throw new Error(`Environment variable '${Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL}' or '${Environment.BASE_URL}' must be set to submit content migration jobs`);
  } else {
    const aws = envConfig.aws();
    if (!aws?.accessKeyId || !aws?.secretAccessKey || !aws?.bucket || !aws?.region) {
      throw new Error("AWS bucket, region and credentials must be configured to run content migration on the integration worker");
    } else {
      const mongoUri = envConfig.mongo()?.uri;
      if (!mongoUri) {
        throw new Error("Mongo URI must be configured to run content migration on the integration worker");
      } else {
        const callback: IntegrationWorkerCallbackConfig = {
          baseUrl: callbackBaseUrl,
          progressPath: "/api/integration-worker/content-migration/progress",
          resultPath: "/api/integration-worker/content-migration/result"
        };
        const request: IntegrationWorkerContentMigrationJobRequest = {
          jobId,
          migrationRequest,
          mongoUri,
          awsConfig: { bucket: aws.bucket, region: aws.region },
          encryptedAwsCredentials: encryptRamblersUploadPayload<IntegrationWorkerAwsCredentials>({
            accessKeyId: aws.accessKeyId,
            secretAccessKey: aws.secretAccessKey
          }, encryptionKey),
          callback
        };
        const endpoint = `${stripTrailingSlash(workerUrl)}/api/integration-worker/content-migration/jobs`;
        debugLog("-> submit content migration jobId:", jobId, "endpoint:", endpoint, "bucket:", aws.bucket, "region:", aws.region);
        const response = await signedJsonPost(endpoint, sharedSecret, request);
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`Integration worker content migration submit failed with status ${response.status}: ${text}`);
        }
      }
    }
  }
}

export async function cancelContentMigrationJobOnIntegrationWorker(jobId: string): Promise<void> {
  const workerUrl = required(Environment.INTEGRATION_WORKER_URL);
  const sharedSecret = required(Environment.INTEGRATION_WORKER_SHARED_SECRET);
  const endpoint = `${stripTrailingSlash(workerUrl)}/api/integration-worker/content-migration/jobs/${encodeURIComponent(jobId)}/cancel`;
  debugLog("-> cancel content migration jobId:", jobId);
  const response = await signedJsonPost(endpoint, sharedSecret, {});
  if (!response.ok) {
    throw new Error(`Integration worker content migration cancel failed with status ${response.status}`);
  }
}
