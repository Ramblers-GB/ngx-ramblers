import { Request, Response } from "express";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { IntegrationWorkerResultCallbackRequest } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { Status } from "../../../projects/ngx-ramblers/src/app/models/ramblers-upload-audit.model";
import { ServerDownloadStatusType } from "../../../projects/ngx-ramblers/src/app/models/walk.model";
import { completeOsMapsExportResult, osMapsExportResultByJobId } from "../os-maps/os-maps-export-result-store";
import { saveOsMapsRouteListing } from "../os-maps/os-maps-route-listing-store";
import { applyOsMapsExportWorkerResult } from "../os-maps/os-maps-gpx-attach";
import { applyOsDataHubApiKeyWorkerResult } from "../os-maps/os-data-hub-api-key-store";
import { verifySignedJsonRequest } from "./integration-worker-crypto";
import * as auditNotifier from "./ramblers-upload-audit-notifier";
import * as auditParser from "./ramblers-audit-parser";
import { downloadStatusManager } from "./download-status-manager";
import { activateRamblersUploadSession, currentRamblersUploadSession } from "./ramblers-upload-session-registry";
import { applyWalksManagerAccessWorkerResult } from "./walks-manager-access-store";

const debugLog = debug(envConfig.logNamespace("integration-worker-routes"));
debugLog.enabled = true;

export function requiredValue(environmentVariable: Environment): string {
  const value = envConfig.value(environmentVariable);
  if (!value) {
    throw new Error(`Environment variable '${environmentVariable}' must be set`);
  } else {
    return value;
  }
}

export function callbackSecret(): string {
  return envConfig.value(Environment.INTEGRATION_WORKER_CALLBACK_SECRET)
    || requiredValue(Environment.INTEGRATION_WORKER_SHARED_SECRET);
}

export async function integrationWorkerResult(req: Request, res: Response): Promise<void> {
  const incomingJobId = (req.body as IntegrationWorkerResultCallbackRequest | undefined)?.jobId;
  const incomingStatus = (req.body as IntegrationWorkerResultCallbackRequest | undefined)?.status;
  debugLog("POST /result received: jobId:", incomingJobId, "status:", incomingStatus);
  try {
    if (!verifySignedJsonRequest(req, callbackSecret())) {
      debugLog("POST /result rejected: invalid signature for jobId:", incomingJobId);
      res.status(401).json({ error: "Invalid upload worker callback signature" });
    } else {
      await applyWorkerResult(req.body as IntegrationWorkerResultCallbackRequest, res);
    }
  } catch (error) {
    debugLog("POST /result error for jobId:", incomingJobId, "error:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
}

async function applyWorkerResult(request: IntegrationWorkerResultCallbackRequest, res: Response): Promise<void> {
  if (request.listedRoutes) {
    const listingJob = await osMapsExportResultByJobId(request.jobId);
    await saveOsMapsRouteListing(request.listedRoutes, listingJob?.accountOwnerId || null);
    if (listingJob) {
      await completeOsMapsExportResult(request.jobId, []);
    }
  }
  const handledExport = await applyOsMapsExportWorkerResult(request.jobId, request.exportedGpx, request.payload)
    || await applyOsDataHubApiKeyWorkerResult(request.jobId, request.osDataHubApiKey, request.payload)
    || await applyWalksManagerAccessWorkerResult(request.jobId, request.walksManagerAccess, request.payload);
  const session = currentRamblersUploadSession(request.jobId);

  if (!session) {
    debugLog("POST /result no active session for jobId:", request.jobId);
    if (!!request.listedRoutes || handledExport) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: `No upload session found for job ${request.jobId}` });
    }
  } else {
    activateRamblersUploadSession(request.jobId);
    if (request.reportKeyPrefix && request.reportBucket) {
      await auditNotifier.recordReportLocation(request.jobId, request.reportBucket, request.reportKeyPrefix);
    }
    await auditNotifier.sendAudit(session.ws, {
      messageType: MessageType.COMPLETE,
      auditMessage: request.payload || "Upload completed",
      parserFunction: auditParser.parseExit,
      status: (request.status as Status) || Status.INFO
    }, request.jobId);
    downloadStatusManager.completeDownload(request.status === Status.SUCCESS ? ServerDownloadStatusType.COMPLETED : ServerDownloadStatusType.ERROR);
    debugLog("POST /result forwarded to session for jobId:", request.jobId, "reportKeyPrefix:", request.reportKeyPrefix);
    res.json({ success: true });
  }
}
