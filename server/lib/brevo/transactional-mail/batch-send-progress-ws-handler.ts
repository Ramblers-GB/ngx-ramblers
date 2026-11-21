import WebSocket from "ws";
import { Request } from "express";
import { memberFromRequest } from "../../auth/request-member";
import { BatchSendEntryStatus, BatchSendStatus, BatchSendProgressEvent, BatchSendProgressWatch, BATCH_SEND_JOB_LOST_MESSAGE } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { MessageType } from "../../../../projects/ngx-ramblers/src/app/models/websocket.model";
import { batchSendJobs, observeBatchProgress } from "./batch-send-progress";

const revisions = new WeakMap<WebSocket, Map<string, number>>();
const subscriptions = new WeakMap<WebSocket, Map<string, () => void>>();

export async function handleBatchSendProgress(ws: WebSocket, request: BatchSendProgressWatch, authToken: string | null = null): Promise<void> {
  const jobId = request?.jobId;
  const versions = revisions.get(ws) ?? new Map<string, number>();
  revisions.set(ws, versions);
  const version = (versions.get(jobId) ?? 0) + 1;
  versions.set(jobId, version);
  const send = (event: BatchSendProgressEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 1024 * 1024) {
        ws.close(1013, "Reconnect to resume email progress");
      } else {
        ws.send(JSON.stringify({type: MessageType.BATCH_SEND_PROGRESS, data: event}));
      }
    }
  };
  try {
    const member = await memberFromRequest({headers: {authorization: authToken ? `Bearer ${authToken}` : ""}} as Request);
    if (versions.get(jobId) === version && ws.readyState === WebSocket.OPEN) {
      const progress = batchSendJobs.get(jobId);
      if (!member?.memberId || (progress && progress.requestedBy !== member.memberId)) {
        send({jobId, snapshot: false, error: {status: 403, message: "You can only view your own email sends"}});
      } else if (!progress) {
        send({jobId, snapshot: false, error: {status: 404, message: BATCH_SEND_JOB_LOST_MESSAGE}});
      } else {
        const watching = subscriptions.get(ws) ?? new Map<string, () => void>();
        subscriptions.set(ws, watching);
        watching.get(jobId)?.();
        if (!request.unsubscribe) {
          const onClose = () => stop();
          const unsubscribe = observeBatchProgress(jobId, send);
          const stop = () => {
            unsubscribe();
            watching.delete(jobId);
            ws.off("close", onClose);
          };
          watching.set(jobId, stop);
          ws.on("close", onClose);
          send({jobId, snapshot: true, progress: {
            ...progress, entries: progress.status === BatchSendStatus.RUNNING
              ? progress.entries.filter(entry => entry.status !== BatchSendEntryStatus.Pending)
              : progress.entries
          }});
        }
      }
    }
  } catch {
    if (versions.get(jobId) === version) {
      send({jobId, snapshot: false, error: {status: 403, message: "Sign in again to view email progress"}});
    }
  }
}
