import WebSocket from "ws";
import debug from "debug";
import { Request } from "express";
import { envConfig } from "../env-config/env-config";
import { memberFromRequest } from "../auth/request-member";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import {
  ContributorBundleWsComplete,
  ContributorBundleWsError,
  ContributorBundleWsProgress,
  ContributorBundleWsRequest
} from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { generateContributorBundle } from "./contributor-bundle-service";

const debugLog = debug(envConfig.logNamespace("contributor-environment:bundle-ws"));
debugLog.enabled = true;

export async function handleContributorBundle(ws: WebSocket, data: ContributorBundleWsRequest, authToken: string | null = null): Promise<void> {
  const requestId = String(data?.requestId || "");
  const send = (messageType: MessageType, payload: ContributorBundleWsProgress | ContributorBundleWsComplete | ContributorBundleWsError) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({type: messageType, data: payload}));
    }
  };
  const member = await memberFromRequest({headers: {authorization: authToken ? `Bearer ${authToken}` : ""}} as Request);
  if (!member?.memberAdmin) {
    send(MessageType.ERROR, {requestId, message: "Sign in as a member admin to generate a contributor environment"});
  } else {
    try {
      const bundle = await generateContributorBundle(
        {environmentName: data?.environmentName, schema: data?.schema, clone: data?.clone === true},
        member.memberId || null,
        message => send(MessageType.PROGRESS, {requestId, message})
      );
      send(MessageType.COMPLETE, {requestId, fileName: bundle.fileName, zipBase64: bundle.zip.toString("base64")});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog("contributor bundle failed:", message);
      send(MessageType.ERROR, {requestId, message});
    }
  }
}
