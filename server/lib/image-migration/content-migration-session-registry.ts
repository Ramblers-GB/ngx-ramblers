import WebSocket from "ws";

export interface ContentMigrationSession {
  jobId: string;
  ws: WebSocket;
}

const sessions = new Map<string, ContentMigrationSession>();

export function registerContentMigrationSession(session: ContentMigrationSession): void {
  sessions.set(session.jobId, session);
}

export function contentMigrationSession(jobId: string | undefined): ContentMigrationSession | undefined {
  if (!jobId) {
    return undefined;
  } else {
    return sessions.get(jobId);
  }
}

export function completeContentMigrationSession(jobId: string): void {
  sessions.delete(jobId);
}

export function activeContentMigrationJobIdForSocket(ws: WebSocket): string | null {
  const match = Array.from(sessions.values()).find(session => session.ws === ws);
  if (match) {
    return match.jobId;
  } else {
    return null;
  }
}
