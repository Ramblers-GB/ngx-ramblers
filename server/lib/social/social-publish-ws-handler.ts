import WebSocket from "ws";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { ApiAction } from "../../../projects/ngx-ramblers/src/app/models/api-response.model";
import {
  SocialNetwork,
  SocialPublishJobRequest,
  SocialPublishProgress,
  SocialPublishResult
} from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { IntegrationWorkerSocialPublishNetworkImages } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { systemConfig } from "../config/system-config";
import { resolveAlbumImages } from "./album-images";
import { withLink } from "./caption-builder";
import { socialPublication } from "../mongo/models/social-publication";
import { dateTimeNowAsValue } from "../shared/dates";
import { livePublicationOrNull } from "./publication-status";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";
import { socialPublishCompleteMessage, socialPublishFailed } from "./social-publish-outcome";
import { completeSocialPublishSession, registerSocialPublishSession } from "./social-publish-session-registry";
import { submitSocialPublishJobToIntegrationWorker } from "../ramblers/integration-worker-social-publish-client";
import { integrationWorkerConfigured } from "../ramblers/dispatch-integration-worker-job";

const debugLog = debug(envConfig.logNamespace("social:publish-ws"));
debugLog.enabled = true;

function sendProgress(ws: WebSocket, jobId: string, progress: SocialPublishProgress): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: MessageType.PROGRESS,
      data: {action: ApiAction.UPDATE, jobId, ...progress}
    }));
  }
}

function sendError(ws: WebSocket, jobId: string, message: string, data?: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: MessageType.ERROR,
      data: {action: ApiAction.UPDATE, jobId, message, ...data}
    }));
  }
}

function sendComplete(ws: WebSocket, jobId: string, message: string, data?: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: MessageType.COMPLETE,
      data: {action: ApiAction.UPDATE, jobId, message, ...data}
    }));
  }
}

function publicBaseUrlFor(config: SystemConfig, requestedBaseUrl?: string): string {
  const configured = stripTrailingSlash((config?.group?.href || "").trim());
  const requested = stripTrailingSlash((requestedBaseUrl || "").trim());
  let baseUrl = "";
  if (configured) {
    baseUrl = configured;
  } else if (requested) {
    baseUrl = requested;
  } else {
    throw new Error("Set Web Url in System Settings → Area & Group so social networks can fetch album images");
  }
  return baseUrl;
}

function finishPublish(ws: WebSocket, jobId: string, results: SocialPublishResult[]): void {
  const message = socialPublishCompleteMessage(results);
  if (socialPublishFailed(results)) {
    sendError(ws, jobId, message, {results});
  } else {
    sendComplete(ws, jobId, message, {results});
  }
}

export async function handleSocialPublishAlbum(ws: WebSocket, data: SocialPublishJobRequest): Promise<void> {
  const jobId = data?.jobId || `social-publish-${dateTimeNowAsValue()}`;
  debugLog("handleSocialPublishAlbum: received request", {
    jobId,
    albumName: data?.albumName,
    networks: data?.networks,
    imageCount: data?.imageNames?.length
  });
  try {
    const albumName = data?.albumName;
    const networks = (data?.networks || []).filter(Boolean);
    const imageNames = data?.imageNames || [];
    if (!albumName) {
      sendError(ws, jobId, "Album name is required");
    } else if (networks.length === 0) {
      sendError(ws, jobId, "Choose at least one network to publish to");
    } else if (imageNames.length === 0) {
      sendError(ws, jobId, "Select at least one image to publish");
    } else {
      const config: SystemConfig = await systemConfig();
      const baseUrl = publicBaseUrlFor(config, data?.publicBaseUrl);
      const imageNamesFor = (network: SocialNetwork): string[] => {
        const perNetwork = data?.imageNamesByNetwork?.[network];
        return perNetwork?.length ? perNetwork : imageNames;
      };
      const allImageNames = Array.from(new Set(networks.flatMap(network => imageNamesFor(network))));
      sendProgress(ws, jobId, {
        message: `Resolving ${allImageNames.length} album images`,
        phase: "resolve-images",
        completed: 0,
        total: networks.length,
        percent: 0
      });
      const resolvedImages = await resolveAlbumImages(baseUrl, albumName, allImageNames);
      const imagesByName = new Map(resolvedImages.map(image => [image.image, image]));
      debugLog("resolved images:", resolvedImages.length, "baseUrl:", baseUrl);
      const priorResults: SocialPublishResult[] = [];
      const pending: IntegrationWorkerSocialPublishNetworkImages[] = [];
      for (const network of networks) {
        const enteredCaption = data?.captions?.[network] || "";
        const caption = withLink(enteredCaption, data?.albumUrl, "See the full album:");
        const networkImageNames = imageNamesFor(network);
        const networkImages = networkImageNames.map(name => imagesByName.get(name)).filter(Boolean);
        if (!enteredCaption?.trim()) {
          priorResults.push({network, success: false, error: `A caption is required for ${network}`});
        } else if (networkImages.length === 0) {
          priorResults.push({network, success: false, error: `Select at least one image to publish to ${network}`});
        } else {
          const recorded = await socialPublication.findOne({albumName, network}).lean().exec() as {postId?: string; permalink?: string; network?: SocialNetwork} | null;
          const existing = await livePublicationOrNull(recorded, config?.externalSystems?.facebook?.pageAccessToken);
          if (existing) {
            priorResults.push({
              network,
              success: false,
              error: `This album has already been published to ${network} (post ${existing.postId || existing.permalink || "recorded"})`
            });
          } else {
            pending.push({network, images: networkImages, imageNames: networkImageNames, caption});
          }
        }
      }
      if (pending.length === 0) {
        finishPublish(ws, jobId, priorResults);
      } else if (!integrationWorkerConfigured()) {
        debugLog("album publish requires INTEGRATION_WORKER_URL; refusing in-process fallback");
        sendError(ws, jobId, "Album publish runs on the integration worker. Set INTEGRATION_WORKER_URL (local ngx-cli starts a worker on the next port).");
      } else {
        debugLog("dispatching album publish to integration worker", {jobId, albumName, networks: pending.map(item => item.network)});
        registerSocialPublishSession({jobId, ws, albumName, pending, priorResults});
        sendProgress(ws, jobId, {
          message: "Sending album publish to the integration worker",
          phase: "queued",
          percent: 0
        });
        try {
          const submitted = await submitSocialPublishJobToIntegrationWorker(
            jobId,
            albumName,
            pending,
            config?.externalSystems?.facebook,
            config?.externalSystems?.instagram
          );
          if (submitted.queued) {
            sendProgress(ws, jobId, {
              message: `Queued at position ${submitted.queuePosition} on the integration worker`,
              phase: "queued",
              percent: 0
            });
          }
        } catch (error) {
          completeSocialPublishSession(jobId);
          sendError(ws, jobId, error?.message || String(error));
        }
      }
    }
  } catch (error) {
    debugLog("handleSocialPublishAlbum error:", error);
    sendError(ws, jobId, error?.message || String(error));
  }
}
