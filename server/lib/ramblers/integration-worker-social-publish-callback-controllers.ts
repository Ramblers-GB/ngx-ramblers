import debug from "debug";
import { Request, Response } from "express";
import { verifySignedJsonRequest } from "./integration-worker-crypto";
import { envConfig } from "../env-config/env-config";
import {
  IntegrationWorkerResultStatus,
  IntegrationWorkerSocialPublishProgressCallback,
  IntegrationWorkerSocialPublishResultCallback
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { ApiAction } from "../../../projects/ngx-ramblers/src/app/models/api-response.model";
import {
  completeSocialPublishSession,
  currentSocialPublishSession,
  SocialPublishSession
} from "../social/social-publish-session-registry";
import { recordSocialPublications } from "../social/social-publish-record";
import { socialPublishCompleteMessage, socialPublishFailed } from "../social/social-publish-outcome";
import { SocialPublishResult } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";

const debugLog = debug(envConfig.logNamespace("integration-worker-social-publish-callback-controllers"));
debugLog.enabled = true;

export async function socialPublishProgress(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerSocialPublishProgressCallback;
    const session = currentSocialPublishSession(body?.jobId);
    if (!session) {
      debugLog("progress: no session for jobId:", body?.jobId);
      res.status(404).json({error: `No social publish session for jobId ${body?.jobId}`});
    } else {
      sendToSession(session, {
        type: MessageType.PROGRESS,
        data: {action: ApiAction.UPDATE, jobId: session.jobId, ...body.progress}
      });
      res.json({ok: true});
    }
  }
}

export async function socialPublishResult(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    res.status(401).json({error: "Invalid integration worker callback signature"});
  } else {
    const body = req.body as IntegrationWorkerSocialPublishResultCallback;
    const session = currentSocialPublishSession(body?.jobId);
    if (!session) {
      debugLog("result: no session for jobId:", body?.jobId);
      res.status(404).json({error: `No social publish session for jobId ${body?.jobId}`});
    } else {
      try {
        await emitResult(session, body);
      } finally {
        completeSocialPublishSession(body.jobId);
      }
      res.json({ok: true});
    }
  }
}

async function emitResult(session: SocialPublishSession, result: IntegrationWorkerSocialPublishResultCallback): Promise<void> {
  if (result.status === IntegrationWorkerResultStatus.Error) {
    sendToSession(session, {
      type: MessageType.ERROR,
      data: {action: ApiAction.UPDATE, jobId: session.jobId, message: result.errorMessage || "Social publish failed"}
    });
  } else {
    const workerResults = result.results || [];
    await recordSocialPublications(session.albumName, workerResults, session.pending);
    const results: SocialPublishResult[] = [...session.priorResults, ...workerResults];
    const message = socialPublishCompleteMessage(results);
    sendToSession(session, {
      type: socialPublishFailed(results) ? MessageType.ERROR : MessageType.COMPLETE,
      data: {action: ApiAction.UPDATE, jobId: session.jobId, message, results}
    });
  }
}

function sendToSession(session: SocialPublishSession, message: object): void {
  try {
    if (session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify(message));
    }
  } catch (wsError) {
    debugLog("ws.send failed for jobId:", session.jobId, "error:", (wsError as Error).message);
  }
}


