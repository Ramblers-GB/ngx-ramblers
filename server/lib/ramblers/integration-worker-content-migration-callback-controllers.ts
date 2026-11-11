import debug from "debug";
import { Request, Response } from "express";
import { verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import {
  IntegrationWorkerContentMigrationProgressCallback,
  IntegrationWorkerContentMigrationResultCallback,
  IntegrationWorkerResultStatus
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { ApiAction } from "../../../projects/ngx-ramblers/src/app/models/api-response.model";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { completeContentMigrationSession, contentMigrationSession } from "../image-migration/content-migration-session-registry";

const debugLog = debug(envConfig.logNamespace("integration-worker-content-migration-callback-controllers"));
debugLog.enabled = true;

function decodeUrlForDisplay(value: string): string {
  if (!value) {
    return value;
  } else {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }
}

export async function contentMigrationProgressCallback(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({ error: "Invalid integration worker callback signature" });
  } else {
    const body = req.body as IntegrationWorkerContentMigrationProgressCallback;
    const session = contentMigrationSession(body?.jobId);
    if (!session) {
      debugLog("progress: no session for jobId:", body?.jobId);
      res.status(404).json({ error: `No content migration session for jobId ${body?.jobId}` });
    } else {
      const decodedItem = body.progress?.currentItem ? decodeUrlForDisplay(body.progress.currentItem) : body.message;
      const decodedError = body.progress?.errorMessage ? decodeUrlForDisplay(body.progress.errorMessage) : body.progress?.errorMessage;
      const progress = body.progress
        ? { ...body.progress, currentItem: decodedItem, errorMessage: decodedError }
        : undefined;
      session.ws.send(JSON.stringify({
        type: MessageType.PROGRESS,
        data: { message: decodedItem, progress, queued: body.queued }
      }));
      res.json({ ok: true });
    }
  }
}

export async function contentMigrationResultCallback(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({ error: "Invalid integration worker callback signature" });
  } else {
    const body = req.body as IntegrationWorkerContentMigrationResultCallback;
    const session = contentMigrationSession(body?.jobId);
    if (!session) {
      debugLog("result: no session for jobId:", body?.jobId);
      res.status(404).json({ error: `No content migration session for jobId ${body?.jobId}` });
    } else {
      try {
        if (body.status === IntegrationWorkerResultStatus.Error) {
          session.ws.send(JSON.stringify({
            type: MessageType.ERROR,
            data: { action: ApiAction.QUERY, message: body.errorMessage || "Migration failed" }
          }));
        } else if (body.cancelled || body.result?.cancelled) {
          const result = body.result;
          const summary = `Migration cancelled: ${result?.successCount || 0} succeeded, ${result?.failureCount || 0} failed before cancellation`;
          session.ws.send(JSON.stringify({
            type: MessageType.CANCELLED,
            data: { action: ApiAction.UPDATE, message: summary, migrationResult: result }
          }));
        } else {
          const result = body.result;
          const summary = `Migration complete: ${result?.successCount || 0} succeeded, ${result?.failureCount || 0} failed`;
          session.ws.send(JSON.stringify({
            type: MessageType.COMPLETE,
            data: { action: ApiAction.UPDATE, message: summary, migrationResult: result }
          }));
        }
      } finally {
        completeContentMigrationSession(body.jobId);
      }
      res.json({ ok: true });
    }
  }
}
