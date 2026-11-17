import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { pluraliseWithCount } from "../shared/string-utils";
import { recordRunsStoppedByShutdown } from "../cron/scheduled-task-registry";

const debugLog = debug(envConfig.logNamespace("shutdown-signals"));
debugLog.enabled = true;

export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
export const SHUTDOWN_RECORDING_LIMIT_MS = 3000;
const installed = {value: false};
const shutdown = {started: false};

export async function recordStoppedRunsThenExit(signal: string, recordStoppedRuns: () => Promise<number>, exit: (code: number) => void, limitMs: number = SHUTDOWN_RECORDING_LIMIT_MS): Promise<void> {
  const limit = new Promise<string>(resolve => {
    const timer = setTimeout(() => resolve("time limit reached before stopped runs were recorded"), limitMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([
      recordStoppedRuns().then(count => `${pluraliseWithCount(count, "in-progress scheduled task run")} recorded as stopped`),
      limit
    ]);
    debugLog(`${signal} received: ${outcome}`);
  } catch (error) {
    debugLog(`${signal} received: recording stopped runs failed`, error);
  } finally {
    exit(0);
  }
}

export function installShutdownSignalHandlers(): void {
  if (!installed.value) {
    SHUTDOWN_SIGNALS.forEach(signal => process.on(signal, () => {
      if (!shutdown.started) {
        shutdown.started = true;
        void recordStoppedRunsThenExit(signal, recordRunsStoppedByShutdown, code => process.exit(code));
      }
    }));
    installed.value = true;
    debugLog("shutdown signal handlers installed");
  }
}
