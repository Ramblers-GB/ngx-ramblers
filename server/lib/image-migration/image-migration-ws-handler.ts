import WebSocket from "ws";
import { Request } from "express";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { ApiAction } from "../../../projects/ngx-ramblers/src/app/models/api-response.model";
import {
  ContentMigrationRequest,
  ContentMigrationScanRequest
} from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { scanForExternalContent, scanForUniqueHosts } from "./image-migration-scanner";
import { cancelContentMigrationJobOnIntegrationWorker, submitContentMigrationJobToIntegrationWorker } from "../ramblers/integration-worker-content-migration-client";
import { dateTimeNowAsValue } from "../shared/dates";
import {
  activeContentMigrationJobIdForSocket,
  completeContentMigrationSession,
  registerContentMigrationSession
} from "./content-migration-session-registry";
import { hasAdminPrivilege, memberFromRequest } from "../auth/request-member";

const debugLog = debug(envConfig.logNamespace("content-migration-ws-handler"));
debugLog.enabled = true;

function sendProgress(ws: WebSocket, message: string, data?: any): void {
  ws.send(JSON.stringify({
    type: MessageType.PROGRESS,
    data: { message, ...data }
  }));
}

function sendError(ws: WebSocket, message: string): void {
  ws.send(JSON.stringify({
    type: MessageType.ERROR,
    data: { action: ApiAction.QUERY, message }
  }));
}

function sendComplete(ws: WebSocket, message: string, data?: any): void {
  ws.send(JSON.stringify({
    type: MessageType.COMPLETE,
    data: { action: ApiAction.UPDATE, message, ...data }
  }));
}

async function requireContentMigrationAdmin(ws: WebSocket, authToken: string | null): Promise<boolean> {
  const member = await memberFromRequest({headers: {authorization: authToken ? `Bearer ${authToken}` : ""}} as Request);
  if (!hasAdminPrivilege(member)) {
    debugLog("rejected unauthenticated or non-admin content migration");
    sendError(ws, "Admin access required");
    return false;
  } else {
    return true;
  }
}

export async function handleContentMigrationScanHosts(ws: WebSocket, data: any, authToken: string | null = null): Promise<void> {
  debugLog("handleContentMigrationScanHosts:scanning for unique hosts");

  try {
    if (await requireContentMigrationAdmin(ws, authToken)) {
      sendProgress(ws, "Scanning database for external content hosts...");
      const hosts = await scanForUniqueHosts();
      const summary = `Found ${hosts.length} unique external hosts`;
      debugLog("handleContentMigrationScanHosts:completed:", summary);
      sendComplete(ws, summary, { hosts });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Host scan failed";
    debugLog("handleContentMigrationScanHosts:error:", message);
    sendError(ws, message);
  }
}

export async function handleContentMigrationScan(ws: WebSocket, data: any, authToken: string | null = null): Promise<void> {
  debugLog("handleContentMigrationScan:received request:", data);

  try {
    if (await requireContentMigrationAdmin(ws, authToken)) {
    const request: ContentMigrationScanRequest = {
      hostPattern: data?.hostPattern || "",
      scanAlbums: data?.scanAlbums !== false,
      scanPageContent: data?.scanPageContent !== false,
      scanGroupEvents: data?.scanGroupEvents !== false,
      scanSocialEvents: data?.scanSocialEvents !== false
    };

    if (!request.hostPattern) {
      sendError(ws, "Host pattern is required");
      return;
    }

    sendProgress(ws, `Starting scan for external content from host: ${request.hostPattern}`);

    if (request.scanAlbums) {
      sendProgress(ws, "Scanning albums for external content...");
    }
    if (request.scanPageContent) {
      sendProgress(ws, "Scanning page content for external content...");
    }
    if (request.scanGroupEvents) {
      sendProgress(ws, "Scanning group events for external content...");
    }
    if (request.scanSocialEvents) {
      sendProgress(ws, "Scanning social events for external content...");
    }

    const result = await scanForExternalContent(request);

    const summary = `Scan complete: Found ${result.totalItems} items across ${result.totalPages} sources in ${result.scanDurationMs}ms`;
    debugLog("handleContentMigrationScan:completed:", summary);

    sendComplete(ws, summary, { scanResult: result });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    debugLog("handleContentMigrationScan:error:", message);
    sendError(ws, message);
  }
}

export async function handleContentMigrationExecute(ws: WebSocket, data: any, authToken: string | null = null): Promise<void> {
  debugLog("handleContentMigrationExecute:received request with", data?.items?.length, "items, maxImageSize:", data?.maxImageSize);

  try {
    if (await requireContentMigrationAdmin(ws, authToken)) {
    const request: ContentMigrationRequest = {
      items: data?.items || [],
      targetRootFolder: data?.targetRootFolder || "site-content",
      maxImageSize: data?.maxImageSize || 0
    };

    if (!request.items.length) {
      sendError(ws, "No items selected for migration");
    } else {
      const resizeNote = request.maxImageSize > 0 ? ` (resizing images to max ${request.maxImageSize} bytes)` : "";
      sendProgress(ws, `Starting migration of ${request.items.length} items to ${request.targetRootFolder}${resizeNote}`);
      const jobId = `content-migration-${dateTimeNowAsValue()}`;
      registerContentMigrationSession({ jobId, ws });
      sendProgress(ws, "Queued on the integration worker");
      try {
        await submitContentMigrationJobToIntegrationWorker(jobId, request);
      } catch (submitError) {
        completeContentMigrationSession(jobId);
        throw submitError;
      }
    }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    debugLog("handleContentMigrationExecute:error:", message);
    sendError(ws, message);
  }
}

export async function handleContentMigrationCancel(ws: WebSocket, data: any, authToken: string | null = null): Promise<void> {
  debugLog("handleContentMigrationCancel:cancellation requested");
  if (await requireContentMigrationAdmin(ws, authToken)) {
    const jobId = activeContentMigrationJobIdForSocket(ws);
    sendProgress(ws, "Cancellation requested, stopping after current item...");
    if (jobId) {
      try {
        await cancelContentMigrationJobOnIntegrationWorker(jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cancel failed";
        debugLog("handleContentMigrationCancel:error:", message);
        sendError(ws, message);
      }
    }
  }
}
