import debug from "debug";
import { NextFunction, Request, Response } from "express";
import { envConfig } from "../env-config/env-config";
import { dateTimeNowAsValue } from "../shared/dates";
import * as mongooseClient from "./mongoose-client";

const debugLog = debug(envConfig.logNamespace("machine-resume"));
debugLog.enabled = true;

export const MACHINE_RESUME_TICK_MS = 5000;
export const MACHINE_RESUME_GAP_MS = 120000;

const resumeState = {
  lastTickAt: dateTimeNowAsValue(),
  reconnecting: null as Promise<void> | null,
  watching: false
};

export function resumedAfter(lastTickAt: number, now: number): boolean {
  return now - lastTickAt > MACHINE_RESUME_GAP_MS;
}

function reconnectAfterResume(gapMs: number): Promise<void> {
  resumeState.lastTickAt = dateTimeNowAsValue();
  if (!resumeState.reconnecting) {
    debugLog("Machine resumed after %ds asleep; reopening database connections before serving requests", Math.round(gapMs / 1000));
    resumeState.reconnecting = mongooseClient.disconnect()
      .then(() => mongooseClient.connect())
      .then(() => debugLog("Database connections reopened after resume"))
      .catch(error => debugLog("Reopening database connections after resume failed:", error?.message || error))
      .finally(() => {
        resumeState.reconnecting = null;
      });
  }
  return resumeState.reconnecting;
}

function checkForResume(): Promise<void> {
  const now = dateTimeNowAsValue();
  const gap = now - resumeState.lastTickAt;
  if (!resumeState.watching) {
    return Promise.resolve();
  } else if (resumedAfter(resumeState.lastTickAt, now)) {
    return reconnectAfterResume(gap);
  } else {
    resumeState.lastTickAt = now;
    return resumeState.reconnecting || Promise.resolve();
  }
}

export function startMachineResumeWatch(): void {
  if (!resumeState.watching) {
    resumeState.watching = true;
    resumeState.lastTickAt = dateTimeNowAsValue();
    setInterval(() => {
      void checkForResume();
    }, MACHINE_RESUME_TICK_MS).unref();
  }
}

export function reconnectDatabaseAfterResume(_req: Request, _res: Response, next: NextFunction): void {
  checkForResume().then(() => next()).catch(next);
}
