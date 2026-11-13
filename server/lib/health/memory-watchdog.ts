import debug from "debug";
import { monitorEventLoopDelay } from "perf_hooks";
import { getHeapStatistics } from "v8";
import { readFileSync, writeFileSync } from "fs";
import { isArray, isNumber, isObject } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { AdminPlatformPath } from "../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";
import { WatchdogExitDecision, WatchdogRestartHistory } from "../../../projects/ngx-ramblers/src/app/models/health.model";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";
import { dateTimeNowAsValue } from "../shared/dates";

const debugLog = debug(envConfig.logNamespace("memory-watchdog"));
debugLog.enabled = true;

const BYTES_PER_MB = 1048576;
const KB_PER_MB = 1024;
const NANOS_PER_MS = 1e6;
const WATCHDOG_ALERT_WAIT_MS = 15000;
const RESTART_HISTORY_PATH = "/tmp/ngx-memory-watchdog-restarts.json";

function numberFromEnv(variable: Environment, fallback: number): number {
  const raw = envConfig.value(variable);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function meminfoKb(meminfo: string, key: string): number | null {
  const match = meminfo.match(new RegExp("^" + key + ":\\s+(\\d+)\\s+kB", "m"));
  return match ? Number(match[1]) : null;
}

function machineMemory(): { usedMb: number; totalMb: number; percent: number } | null {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const totalKb = meminfoKb(meminfo, "MemTotal");
    const availableKb = meminfoKb(meminfo, "MemAvailable");
    if (totalKb === null || availableKb === null || totalKb <= 0) {
      return null;
    }
    const usedKb = Math.max(0, totalKb - availableKb);
    return { usedMb: usedKb / KB_PER_MB, totalMb: totalKb / KB_PER_MB, percent: (usedKb / totalKb) * 100 };
  } catch {
    return null;
  }
}

const watchdogRestartHold = {count: 0, reason: null as string | null};

export function holdMemoryWatchdogRestart(reason: string): void {
  watchdogRestartHold.count += 1;
  watchdogRestartHold.reason = reason;
  debugLog(`watchdog restart held (${watchdogRestartHold.count}): ${reason}`);
}

export function releaseMemoryWatchdogRestart(): void {
  watchdogRestartHold.count = Math.max(0, watchdogRestartHold.count - 1);
  if (watchdogRestartHold.count === 0) {
    watchdogRestartHold.reason = null;
  }
  debugLog(`watchdog restart hold count ${watchdogRestartHold.count}`);
}

export function memoryWatchdogRestartHeld(): boolean {
  return watchdogRestartHold.count > 0;
}

export function machineMemoryUsage(): { usedMb: number; totalMb: number; percent: number } | null {
  return machineMemory();
}

export async function waitUntilMachineMemoryAllows(limitPercent: number, label: string): Promise<boolean> {
  const pauseMs = 5000;
  const maximumAttempts = 60;
  const attempt = async (remaining: number): Promise<boolean> => {
    const machine = machineMemory();
    if (!machine || machine.percent < limitPercent) {
      return true;
    } else if (remaining <= 0) {
      debugLog(`${label} still at machine ${machine.percent.toFixed(0)}% after waiting`);
      return false;
    } else {
      debugLog(`${label} paused: machine ${machine.percent.toFixed(0)}% is at or above ${limitPercent}%`);
      await new Promise(resolve => setTimeout(resolve, pauseMs));
      return attempt(remaining - 1);
    }
  };
  return attempt(maximumAttempts);
}

export function emptyWatchdogRestartHistory(): WatchdogRestartHistory {
  return {restarts: [], lastLoopAlertAt: null};
}

export function pruneWatchdogRestartHistory(history: WatchdogRestartHistory, nowMs: number, windowMs: number): WatchdogRestartHistory {
  const cutoff = nowMs - windowMs;
  const restarts = (history.restarts || []).filter(stamp => stamp > cutoff);
  const lastLoopAlertAt = history.lastLoopAlertAt && history.lastLoopAlertAt > cutoff ? history.lastLoopAlertAt : null;
  return {restarts, lastLoopAlertAt};
}

export function watchdogRestartHistoryFromUnknown(value: unknown): WatchdogRestartHistory {
  if (!isObject(value)) {
    return emptyWatchdogRestartHistory();
  } else {
    const record = value as {restarts?: unknown; lastLoopAlertAt?: unknown};
    const restarts = isArray(record.restarts) ? record.restarts.filter(item => isNumber(item) && Number.isFinite(item)) : [];
    const lastLoopAlertAt = isNumber(record.lastLoopAlertAt) && Number.isFinite(record.lastLoopAlertAt) ? record.lastLoopAlertAt : null;
    return {restarts, lastLoopAlertAt};
  }
}

export function decideWatchdogExit(input: {
  held: boolean;
  nowMs: number;
  startedAtMs: number;
  graceMs: number;
  recentRestartCount: number;
  maxRestarts: number;
  fatalBreach: boolean;
}): WatchdogExitDecision {
  if (input.held) {
    return WatchdogExitDecision.HELD;
  } else if (input.nowMs - input.startedAtMs < input.graceMs) {
    return WatchdogExitDecision.STARTUP_GRACE;
  } else if (!input.fatalBreach) {
    return WatchdogExitDecision.MACHINE_PRESSURE;
  } else if (input.recentRestartCount >= input.maxRestarts) {
    return WatchdogExitDecision.RESTART_LOOP;
  } else {
    return WatchdogExitDecision.EXIT;
  }
}

function readRestartHistory(windowMs: number): WatchdogRestartHistory {
  try {
    const parsed = JSON.parse(readFileSync(RESTART_HISTORY_PATH, "utf8"));
    return pruneWatchdogRestartHistory(watchdogRestartHistoryFromUnknown(parsed), dateTimeNowAsValue(), windowMs);
  } catch {
    return emptyWatchdogRestartHistory();
  }
}

function writeRestartHistory(history: WatchdogRestartHistory): void {
  writeFileSync(RESTART_HISTORY_PATH, JSON.stringify(history));
}

export async function notifyMemoryWatchdogRestart(breaches: string[], metrics: string): Promise<void> {
  const base = await siteBaseUrlModule.siteBaseUrl();
  const actionUrl = base ? `${base}/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_HEALTH}` : null;
  const appName = envConfig.value(Environment.FLY_APP_NAME) || envConfig.value(Environment.APP_NAME) || "(none)";
  const sent = await adminAlerts.notifyAdminIncident({
    subject: `[NGX ${envConfig.env}] Memory watchdog restarting the process`,
    category: "memory-watchdog:restart",
    title: "Memory watchdog restarting the process",
    intro: "The process is about to exit so Fly can start a fresh machine. This is a serious event.",
    items: [
      {label: "Environment", value: envConfig.env},
      {label: "App", value: appName},
      {label: "Reason", value: breaches.join(", ")}
    ],
    message: "The event loop or memory limits were breached twice in a row. The HTTP server will stop after this alert is sent.",
    details: metrics,
    actionUrl,
    actionLabel: "Open Environments Monitoring",
    actionHint: "Admin → Environment management → Environments Monitoring",
    actionFooter: "for machine health."
  });
  if (!sent) {
    debugLog("Memory watchdog restart alert not sent");
  }
}

export async function notifyMemoryWatchdogRestartLoop(breaches: string[], metrics: string, recentRestartCount: number, windowMs: number): Promise<void> {
  const base = await siteBaseUrlModule.siteBaseUrl();
  const actionUrl = base ? `${base}/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_HEALTH}` : null;
  const appName = envConfig.value(Environment.FLY_APP_NAME) || envConfig.value(Environment.APP_NAME) || "(none)";
  const windowMinutes = Math.round(windowMs / 60000);
  const sent = await adminAlerts.notifyAdminIncident({
    subject: `[NGX ${envConfig.env}] Memory watchdog restart loop suppressed`,
    category: "memory-watchdog:restart-loop",
    title: "Memory watchdog restart loop suppressed",
    intro: "The process stayed up because a restart would not have recovered machine memory. Further exits are suppressed for the rest of the window.",
    items: [
      {label: "Environment", value: envConfig.env},
      {label: "App", value: appName},
      {label: "Reason", value: breaches.join(", ")},
      {label: "Restarts in window", value: `${recentRestartCount} in ${windowMinutes} minutes`}
    ],
    message: "Machine memory is still over the limit after recent self-restarts. Heap and the event loop are left running so the site stays available.",
    details: metrics,
    actionUrl,
    actionLabel: "Open Environments Monitoring",
    actionHint: "Admin → Environment management → Environments Monitoring",
    actionFooter: "for machine health."
  });
  if (!sent) {
    debugLog("Memory watchdog restart-loop alert not sent");
  }
}

async function exitAfterWatchdogAlert(breaches: string[], metrics: string): Promise<void> {
  try {
    await Promise.race([
      notifyMemoryWatchdogRestart(breaches, metrics),
      new Promise<void>(resolve => {
        setTimeout(resolve, WATCHDOG_ALERT_WAIT_MS);
      })
    ]);
  } catch (error: any) {
    debugLog("Memory watchdog restart alert failed:", error?.message || error);
  }
  process.exit(1);
}

export function startMemoryWatchdog(): void {
  if (envConfig.value(Environment.MEMORY_WATCHDOG_ENABLED) === "false") {
    debugLog("memory watchdog disabled via MEMORY_WATCHDOG_ENABLED=false");
    return;
  }
  const intervalMs = numberFromEnv(Environment.MEMORY_WATCHDOG_INTERVAL_MS, 20000);
  const machinePercentLimit = numberFromEnv(Environment.MEMORY_WATCHDOG_MACHINE_PERCENT, 85);
  const heapPercentLimit = numberFromEnv(Environment.MEMORY_WATCHDOG_HEAP_PERCENT, 90);
  const rssMbLimit = numberFromEnv(Environment.MEMORY_WATCHDOG_RSS_MB, 0);
  const loopLagMsLimit = numberFromEnv(Environment.MEMORY_WATCHDOG_LOOP_LAG_MS, 8000);
  const consecutiveTrips = numberFromEnv(Environment.MEMORY_WATCHDOG_TRIPS, 2);
  const graceMs = numberFromEnv(Environment.MEMORY_WATCHDOG_GRACE_MS, 120000);
  const maxRestarts = numberFromEnv(Environment.MEMORY_WATCHDOG_MAX_RESTARTS, 2);
  const restartWindowMs = numberFromEnv(Environment.MEMORY_WATCHDOG_RESTART_WINDOW_MS, 30 * 60 * 1000);
  const heapLimitMb = getHeapStatistics().heap_size_limit / BYTES_PER_MB;
  const machineAtStart = machineMemory();
  const startedAtMs = dateTimeNowAsValue();

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

  const tripState = {count: 0};
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    const heapUsedMb = memory.heapUsed / BYTES_PER_MB;
    const rssMb = memory.rss / BYTES_PER_MB;
    const heapPercent = heapLimitMb > 0 ? (heapUsedMb / heapLimitMb) * 100 : 0;
    const loopLagMs = loopDelay.max / NANOS_PER_MS;
    loopDelay.reset();
    const machine = machineMemory();
    const metrics = `machine ${machine ? machine.usedMb.toFixed(0) + "/" + machine.totalMb.toFixed(0) + "MB" : "n/a"}, heap ${heapUsedMb.toFixed(0)}/${heapLimitMb.toFixed(0)}MB, rss ${rssMb.toFixed(0)}MB, loopLag ${loopLagMs.toFixed(0)}ms`;

    const machineBreach = machine && machine.percent >= machinePercentLimit ? `machine ${machine.percent.toFixed(0)}% (${machine.usedMb.toFixed(0)}/${machine.totalMb.toFixed(0)}MB)` : null;
    const heapBreach = heapPercent >= heapPercentLimit ? `heap ${heapPercent.toFixed(0)}% (${heapUsedMb.toFixed(0)}/${heapLimitMb.toFixed(0)}MB)` : null;
    const rssBreach = rssMbLimit > 0 && rssMb >= rssMbLimit ? `rss ${rssMb.toFixed(0)}MB` : null;
    const loopLagBreach = loopLagMs >= loopLagMsLimit ? `loopLag ${loopLagMs.toFixed(0)}ms` : null;
    const breaches = [machineBreach, heapBreach, rssBreach, loopLagBreach].filter((item): item is string => !!item);
    const fatalBreach = !!(heapBreach || rssBreach || loopLagBreach);

    if (breaches.length === 0) {
      tripState.count = 0;
    } else {
      const nowMs = dateTimeNowAsValue();
      const decision = decideWatchdogExit({
        held: memoryWatchdogRestartHeld(),
        nowMs,
        startedAtMs,
        graceMs,
        recentRestartCount: readRestartHistory(restartWindowMs).restarts.length,
        maxRestarts,
        fatalBreach
      });
      if (decision === WatchdogExitDecision.STARTUP_GRACE) {
        debugLog(`startup grace: ${breaches.join(", ")} (${metrics})`);
      } else if (decision === WatchdogExitDecision.MACHINE_PRESSURE) {
        tripState.count = 0;
        debugLog(`machine pressure only, process stays up: ${breaches.join(", ")} (${metrics})`);
      } else {
        tripState.count += 1;
        debugLog(`WARNING trip ${tripState.count}/${consecutiveTrips}: ${breaches.join(", ")} (${metrics})`);
        if (tripState.count >= consecutiveTrips) {
          if (decision === WatchdogExitDecision.HELD) {
            debugLog(`restart deferred (${watchdogRestartHold.reason}): ${breaches.join(", ")} (${metrics})`);
          } else if (decision === WatchdogExitDecision.RESTART_LOOP) {
            const history = readRestartHistory(restartWindowMs);
            debugLog(`restart loop suppressed (${history.restarts.length} in window): ${breaches.join(", ")} (${metrics})`);
            if (!history.lastLoopAlertAt) {
              history.lastLoopAlertAt = nowMs;
              writeRestartHistory(history);
              void notifyMemoryWatchdogRestartLoop(breaches, metrics, history.restarts.length, restartWindowMs).catch(error => {
                debugLog("Memory watchdog restart-loop alert failed:", error?.message || error);
              });
            }
          } else {
            const history = readRestartHistory(restartWindowMs);
            history.restarts = [...history.restarts, nowMs];
            writeRestartHistory(history);
            console.error(`[memory-watchdog] restarting: ${breaches.join(", ")} — exiting so Fly restarts a fresh machine (${metrics}).`);
            clearInterval(timer);
            void exitAfterWatchdogAlert(breaches, metrics);
          }
        }
      }
    }
  }, intervalMs);
  timer.unref();
  debugLog(`memory watchdog started: interval ${intervalMs}ms, machine>=${machinePercentLimit}%, heap>=${heapPercentLimit}%, rss>=${rssMbLimit > 0 ? rssMbLimit + "MB" : "off"}, loopLag>=${loopLagMsLimit}ms, trips=${consecutiveTrips}, grace=${graceMs}ms, maxRestarts=${maxRestarts}/${restartWindowMs}ms, heapLimit=${heapLimitMb.toFixed(0)}MB, machineTotal=${machineAtStart ? machineAtStart.totalMb.toFixed(0) + "MB" : "n/a"}`);
}
