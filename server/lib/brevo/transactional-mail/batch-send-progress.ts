import debug from "debug";
import { envConfig } from "../../env-config/env-config";
import { EventEmitter } from "events";
import { BatchSendProgress, BatchSendProgressEntry, BatchSendProgressEvent, BatchSendStatus } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";

export const batchSendJobs = new Map<string, BatchSendProgress>();
const changes = new EventEmitter();
const debugLog = debug(envConfig.logNamespace("batch-send-progress"));

export function publishBatchProgress(jobId: string, entry: BatchSendProgressEntry | null = null): void {
  const progress = batchSendJobs.get(jobId);
  if (progress) {
    const snapshot = progress.status !== BatchSendStatus.RUNNING;
    const {ccRecipients, bccRecipients, ...status} = progress;
    const event: BatchSendProgressEvent = {jobId, snapshot, progress: {
      ...status, ...(snapshot ? {ccRecipients, bccRecipients} : {}), entries: snapshot ? progress.entries : entry ? [entry] : []
    }};
    changes.emit(jobId, event);
  }
}

export function observeBatchProgress(jobId: string, listener: (event: BatchSendProgressEvent) => void): () => void {
  const protectedListener = (event: BatchSendProgressEvent) => {
    try {
      listener(event);
    } catch (error) {
      debugLog("progress subscriber disconnected:", error);
      changes.off(jobId, protectedListener);
    }
  };
  changes.on(jobId, protectedListener);
  return () => changes.off(jobId, protectedListener);
}
