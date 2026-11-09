import debug from "debug";
import express, { Request, Response } from "express";
import { verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import {
  IntegrationWorkerWalksManagerSyncProgressCallback,
  IntegrationWorkerWalksManagerSyncResultCallback
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { completeWalksManagerSyncSession, walksManagerSyncSession } from "../walks/walks-manager-sync-session";

const debugLog = debug(envConfig.logNamespace("integration-worker-walks-manager-sync-callback-routes"));
const router = express.Router();

router.post("/progress", async (req: Request, res: Response) => {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerWalksManagerSyncProgressCallback;
    const session = walksManagerSyncSession(body?.jobId);
    if (!session) {
      debugLog("progress: no session for jobId:", body?.jobId);
      res.status(404).json({error: `No walks manager sync session for jobId ${body?.jobId}`});
    } else {
      session.onProgress(body);
      res.json({ok: true});
    }
  }
});

router.post("/result", async (req: Request, res: Response) => {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerWalksManagerSyncResultCallback;
    const session = walksManagerSyncSession(body?.jobId);
    if (!session) {
      debugLog("result: no session for jobId:", body?.jobId);
      res.status(404).json({error: `No walks manager sync session for jobId ${body?.jobId}`});
    } else {
      try {
        session.onResult(body);
      } finally {
        completeWalksManagerSyncSession(body.jobId);
      }
      res.json({ok: true});
    }
  }
});

export const integrationWorkerWalksManagerSyncCallbackRoutes = router;
