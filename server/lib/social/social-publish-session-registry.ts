import WebSocket from "ws";
import { SocialPublishResult } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { IntegrationWorkerSocialPublishNetworkImages } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";

export interface SocialPublishSession {
  jobId: string;
  ws: WebSocket;
  albumName: string;
  pending: IntegrationWorkerSocialPublishNetworkImages[];
  priorResults: SocialPublishResult[];
}

const sessions = new Map<string, SocialPublishSession>();

export function registerSocialPublishSession(session: SocialPublishSession): void {
  sessions.set(session.jobId, session);
}

export function currentSocialPublishSession(jobId: string | undefined): SocialPublishSession | undefined {
  return jobId ? sessions.get(jobId) : undefined;
}

export function completeSocialPublishSession(jobId: string): void {
  sessions.delete(jobId);
}
