import { UploadOutcome } from "../models/integration-worker.model";

const UPLOAD_FINISHED_PREFIX = /^Upload (completed|failed|stopped)\b/;

export const UPLOAD_FINISHED_MESSAGE_PATTERN = UPLOAD_FINISHED_PREFIX.source;

export function uploadFinishedMessage(fileName: string, elapsed: string, outcome: UploadOutcome): string {
  return outcome === UploadOutcome.COMPLETED
    ? `Upload completed for ${fileName} in ${elapsed}`
    : `Upload ${outcome} for ${fileName} after ${elapsed}`;
}

export function isUploadFinishedMessage(message: string): boolean {
  return UPLOAD_FINISHED_PREFIX.test(message || "");
}
