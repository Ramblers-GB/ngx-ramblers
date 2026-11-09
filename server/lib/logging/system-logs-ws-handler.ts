import WebSocket from "ws";
import { Request } from "express";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { MessageType } from "../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { onSystemLog, systemLogSnapshot } from "./system-log-buffer";
import { SystemLogLine } from "../../../projects/ngx-ramblers/src/app/models/system-log.model";
import { hasAdminPrivilege, memberFromRequest } from "../auth/request-member";
import { MemberCookie } from "../../../projects/ngx-ramblers/src/app/models/member.model";

const debugLog = debug(envConfig.logNamespace("system-logs-ws-handler"));
debugLog.enabled = false;

export async function handleSystemLogsWebSocket(ws: WebSocket, _data: unknown, authToken: string | null = null): Promise<void> {
  const send = (type: MessageType, data: {lines?: SystemLogLine[]; line?: SystemLogLine; message?: string}) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({type, data}));
      } catch (error) {
        debugLog("failed to send message:", error);
      }
    }
  };
  const member = await memberFromRequest({headers: {authorization: authToken ? `Bearer ${authToken}` : ""}} as Request);
  if (!systemLogsAdmin(member)) {
    debugLog("rejected unauthenticated or non-admin subscribe");
    send(MessageType.ERROR, {message: "Admin access required"});
    ws.close();
  } else {
    debugLog("client subscribed");
    send(MessageType.SYSTEM_LOG, {lines: systemLogSnapshot()});
    const stop = onSystemLog(line => send(MessageType.SYSTEM_LOG, {line}));
    ws.on("close", () => {
      debugLog("client disconnected");
      stop();
    });
  }
}

function systemLogsAdmin(member: MemberCookie | null): boolean {
  return hasAdminPrivilege(member) || !!member?.volunteerAdmin;
}
