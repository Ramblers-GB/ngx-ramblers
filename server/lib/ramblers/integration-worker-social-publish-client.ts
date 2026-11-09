import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { encryptRamblersUploadPayload, signedJsonPost } from "./integration-worker-crypto";
import {
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerSocialPublishCredentials,
  IntegrationWorkerSocialPublishJobRequest,
  IntegrationWorkerSocialPublishNetworkImages
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { Facebook, Instagram } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("integration-worker-social-publish-client"));
debugLog.enabled = true;

export async function submitSocialPublishJobToIntegrationWorker(
  jobId: string,
  albumName: string,
  networks: IntegrationWorkerSocialPublishNetworkImages[],
  facebook: Facebook,
  instagram: Instagram
): Promise<{queued: boolean; queuePosition: number}> {
  const workerUrl = required(Environment.INTEGRATION_WORKER_URL);
  const sharedSecret = required(Environment.INTEGRATION_WORKER_SHARED_SECRET);
  const encryptionKey = required(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY);
  const callbackBaseUrl = envConfig.value(Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL) || envConfig.value(Environment.BASE_URL);
  if (!callbackBaseUrl) {
    throw new Error(`Environment variable '${Environment.INTEGRATION_WORKER_CALLBACK_BASE_URL}' or '${Environment.BASE_URL}' must be set to submit social publish jobs`);
  } else {
    const callback: IntegrationWorkerCallbackConfig = {
      baseUrl: callbackBaseUrl,
      progressPath: "/api/integration-worker/social-publish/progress",
      resultPath: "/api/integration-worker/social-publish/result"
    };
    const aws = envConfig.aws();
    const credentials: IntegrationWorkerSocialPublishCredentials = {
      facebookPageId: facebook?.pageId,
      facebookPageAccessToken: facebook?.pageAccessToken,
      facebookPublishingEnabled: facebook?.publishingEnabled,
      instagramUserId: instagram?.igUserId,
      instagramPublishingEnabled: instagram?.publishingEnabled,
      awsAccessKeyId: aws?.accessKeyId,
      awsSecretAccessKey: aws?.secretAccessKey
    };
    const request: IntegrationWorkerSocialPublishJobRequest = {
      jobId,
      albumName,
      networks,
      encryptedCredentials: encryptRamblersUploadPayload(credentials, encryptionKey),
      callback
    };
    if (aws?.bucket && aws?.region) {
      request.awsConfig = {bucket: aws.bucket, region: aws.region};
    }
    const endpoint = `${stripTrailingSlash(workerUrl)}/api/integration-worker/social-publish/jobs`;
    debugLog("submit jobId:", jobId, "album:", albumName, "networks:", networks.map(item => item.network), "endpoint:", endpoint);
    const response = await signedJsonPost(endpoint, sharedSecret, request);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Integration worker social publish submit failed with status ${response.status}: ${text}`);
    } else {
      return response.json() as Promise<{queued: boolean; queuePosition: number}>;
    }
  }
}

function required(key: Environment): string {
  const value = envConfig.value(key);
  if (!value) {
    throw new Error(`Environment variable '${key}' must be set to call the integration worker social publish API`);
  } else {
    return value;
  }
}
