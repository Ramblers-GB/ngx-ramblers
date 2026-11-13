import debug from "debug";
import { Request, Response } from "express";
import { envConfig } from "../env-config/env-config";
import { verifySignedJsonRequest } from "./integration-worker-crypto";
import {
  IntegrationWorkerBackupsProgressCallback,
  IntegrationWorkerBackupsResultCallback,
  IntegrationWorkerResultStatus
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { backupsWorkerSession, completeBackupsWorkerSession } from "../backup/backups-worker-session";
import { backupEvents } from "../backup/backup-events";
import { backupSession } from "../mongo/models/backup-session";
import { createBackupAndRestoreService } from "../backup/backup-service-factory";

const debugLog = debug(envConfig.logNamespace("integration-worker-backups-callback"));
debugLog.enabled = true;

export async function backupsProgressCallback(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerBackupsProgressCallback;
    const session = backupsWorkerSession(body?.jobId);
    if (body?.sessionMongoId && backupEvents.listenerCount("session-updated") > 0) {
      const updated = await backupSession.findById(body.sessionMongoId).lean();
      if (updated) {
        backupEvents.emit("session-updated", {session: updated});
      }
    }
    if (!session) {
      debugLog("progress: no waiting cron session for jobId:", body?.jobId);
      res.json({ok: true});
    } else {
      session.onProgress(body);
      res.json({ok: true});
    }
  }
}

export async function backupsResultCallback(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerBackupsResultCallback;
    const session = backupsWorkerSession(body?.jobId);
    if (body?.sessionMongoId && body.status === IntegrationWorkerResultStatus.Error) {
      const service = await createBackupAndRestoreService();
      await service.failPendingBackup(body.sessionMongoId, body.errorMessage || "Backup failed");
    }
    if (!session) {
      debugLog("result: no waiting cron session for jobId:", body?.jobId);
      res.json({ok: true});
    } else {
      try {
        session.onResult(body);
      } finally {
        completeBackupsWorkerSession(body.jobId);
      }
      res.json({ok: true});
    }
  }
}
