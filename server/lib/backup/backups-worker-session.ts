import {
  IntegrationWorkerBackupsProgressCallback,
  IntegrationWorkerBackupsResultCallback
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";

export interface BackupsWorkerSession {
  jobId: string;
  onProgress: (body: IntegrationWorkerBackupsProgressCallback) => void;
  onResult: (body: IntegrationWorkerBackupsResultCallback) => void;
}

const sessions = new Map<string, BackupsWorkerSession>();

export function registerBackupsWorkerSession(session: BackupsWorkerSession): void {
  sessions.set(session.jobId, session);
}

export function backupsWorkerSession(jobId: string): BackupsWorkerSession | null {
  return sessions.get(jobId) || null;
}

export function completeBackupsWorkerSession(jobId: string): void {
  sessions.delete(jobId);
}
