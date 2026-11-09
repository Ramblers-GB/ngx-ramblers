import debug from "debug";
import { Request, Response } from "express";
import { S3 } from "@aws-sdk/client-s3";
import { decryptRamblersUploadPayload, postSignedWorkerBody, verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import {
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerResultStatus,
  IntegrationWorkerSocialPublishCredentials,
  IntegrationWorkerSocialPublishJobRequest,
  IntegrationWorkerSocialPublishProgressCallback,
  IntegrationWorkerSocialPublishResultCallback
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { Facebook, Instagram } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { SocialNetwork } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { integrationWorkerHeavyJobQueue } from "./integration-worker-heavy-job-queue";
import { IntegrationWorkerHeavyJobType } from "../models/integration-worker-heavy-job.model";
import { publishSocialAlbumNetworks } from "../social/social-publish-album-run";
import { instagramImageStoreFor } from "../instagram/instagram-image";

const debugLog = debug(envConfig.logNamespace("integration-worker-social-publish-controllers"));
debugLog.enabled = true;

export async function submitSocialPublishJob(req: Request, res: Response): Promise<void> {
  const incomingJobId = (req.body as IntegrationWorkerSocialPublishJobRequest | undefined)?.jobId;
  const activeJob = integrationWorkerHeavyJobQueue.activeJob();
  debugLog("POST /social-publish/jobs received: jobId:", incomingJobId, "activeJobId:", activeJob?.jobId, "activeJobType:", activeJob?.type);
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker request signature"});
  } else {
    const request = req.body as IntegrationWorkerSocialPublishJobRequest;
    if (!request?.jobId || !request?.albumName || !request?.networks?.length || !request?.encryptedCredentials || !request?.callback) {
      res.status(400).json({error: "jobId, albumName, networks, encryptedCredentials and callback are required"});
    } else {
      const queueResult = integrationWorkerHeavyJobQueue.enqueue({
        jobId: request.jobId,
        type: IntegrationWorkerHeavyJobType.SocialPublish,
        label: `Social publish ${request.albumName}`,
        run: () => runSocialPublish(request)
      });
      debugLog("queued: jobId:", request.jobId, "queued:", queueResult.queued, "position:", queueResult.queuePosition);
      if (queueResult.queued) {
        const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
        void postProgress(request.callback, sharedSecret, {
          jobId: request.jobId,
          progress: {
            message: `Queued at position ${queueResult.queuePosition}; waiting for the current ${queueResult.activeJobType} job`,
            phase: "queued",
            percent: 0
          }
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
}

async function runSocialPublish(request: IntegrationWorkerSocialPublishJobRequest): Promise<void> {
  const sharedSecret = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET) || "";
  try {
    const credentials = decryptRamblersUploadPayload<IntegrationWorkerSocialPublishCredentials>(
      request.encryptedCredentials,
      requiredValue(Environment.INTEGRATION_WORKER_ENCRYPTION_KEY)
    );
    const facebook: Facebook = {
      pageId: credentials.facebookPageId,
      pageAccessToken: credentials.facebookPageAccessToken,
      publishingEnabled: credentials.facebookPublishingEnabled
    };
    const instagram: Instagram = {
      igUserId: credentials.instagramUserId,
      publishingEnabled: credentials.instagramPublishingEnabled
    };
    const needsInstagram = request.networks.some(item => item.network === SocialNetwork.INSTAGRAM);
    const instagramStoreReady = !!(request.awsConfig && credentials.awsAccessKeyId && credentials.awsSecretAccessKey);
    const imageStore = needsInstagram && instagramStoreReady
      ? instagramImageStoreFor(new S3({
        region: request.awsConfig.region,
        credentials: {accessKeyId: credentials.awsAccessKeyId, secretAccessKey: credentials.awsSecretAccessKey}
      }), request.awsConfig.bucket)
      : null;
    const networks = needsInstagram && !instagramStoreReady
      ? request.networks.filter(item => item.network !== SocialNetwork.INSTAGRAM)
      : request.networks;
    const results = await publishSocialAlbumNetworks({
      facebook,
      instagram,
      accessToken: credentials.facebookPageAccessToken,
      networks,
      imageStore,
      onProgress: progress => {
        void postProgress(request.callback, sharedSecret, {jobId: request.jobId, progress});
      }
    });
    if (needsInstagram && !instagramStoreReady) {
      results.push({
        network: SocialNetwork.INSTAGRAM,
        success: false,
        error: "Instagram album publish needs the group's AWS configuration"
      });
    }
    await postResult(request.callback, sharedSecret, {
      jobId: request.jobId,
      status: IntegrationWorkerResultStatus.Success,
      results
    });
  } catch (error) {
    const errorMessage = (error as Error)?.message || "Social publish failed";
    debugLog("job failed jobId:", request.jobId, "error:", errorMessage);
    await postResult(request.callback, sharedSecret, {
      jobId: request.jobId,
      status: IntegrationWorkerResultStatus.Error,
      errorMessage
    });
  }
}

async function postProgress(
  callback: IntegrationWorkerCallbackConfig,
  sharedSecret: string,
  payload: IntegrationWorkerSocialPublishProgressCallback
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
  payload: IntegrationWorkerSocialPublishResultCallback
): Promise<void> {
  try {
    await postSignedWorkerBody(`${callback.baseUrl}${callback.resultPath}`, sharedSecret, payload);
  } catch (error) {
    debugLog("result callback failed jobId:", payload.jobId, "error:", (error as Error).message);
  }
}



function requiredValue(environmentVariable: Environment): string {
  const value = envConfig.value(environmentVariable);
  if (!value) {
    throw new Error(`Environment variable '${environmentVariable}' must be set`);
  } else {
    return value;
  }
}
