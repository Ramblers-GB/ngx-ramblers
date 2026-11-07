import debug from "debug";
import { monitorEventLoopDelay } from "perf_hooks";
import { getHeapStatistics } from "v8";
import { readFileSync } from "fs";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { AdminPlatformPath } from "../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";

const debugLog = debug(envConfig.logNamespace("memory-watchdog"));
debugLog.enabled = true;

const BYTES_PER_MB = 1048576;
const KB_PER_MB = 1024;
const NANOS_PER_MS = 1e6;
const WATCHDOG_ALERT_WAIT_MS = 15000;

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

export async function notifyMemoryWatchdogRestart(breaches: string[], metrics: string): Promise<void> {
  const base = await siteBaseUrlModule.siteBaseUrl();
  const actionUrl = base ? `${base}/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_HEALTH}` : null;
  const appName = envConfig.value(Environment.FLY_APP_NAME) || envConfig.value(Environment.APP_NAME) || "(none)";
  const sent = await adminAlerts.notifyAdminIncident({
    subject: "[NGX platform] Memory watchdog restarting the process",
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
  const heapLimitMb = getHeapStatistics().heap_size_limit / BYTES_PER_MB;
  const machineAtStart = machineMemory();

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

  let trips = 0;
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    const heapUsedMb = memory.heapUsed / BYTES_PER_MB;
    const rssMb = memory.rss / BYTES_PER_MB;
    const heapPercent = heapLimitMb > 0 ? (heapUsedMb / heapLimitMb) * 100 : 0;
    const loopLagMs = loopDelay.max / NANOS_PER_MS;
    loopDelay.reset();
    const machine = machineMemory();

    const breaches = [
      machine && machine.percent >= machinePercentLimit ? `machine ${machine.percent.toFixed(0)}% (${machine.usedMb.toFixed(0)}/${machine.totalMb.toFixed(0)}MB)` : null,
      heapPercent >= heapPercentLimit ? `heap ${heapPercent.toFixed(0)}% (${heapUsedMb.toFixed(0)}/${heapLimitMb.toFixed(0)}MB)` : null,
      rssMbLimit > 0 && rssMb >= rssMbLimit ? `rss ${rssMb.toFixed(0)}MB` : null,
      loopLagMs >= loopLagMsLimit ? `loopLag ${loopLagMs.toFixed(0)}ms` : null
    ].filter((item): item is string => !!item);

    if (breaches.length > 0) {
      trips += 1;
      debugLog(`WARNING trip ${trips}/${consecutiveTrips}: ${breaches.join(", ")} (machine ${machine ? machine.percent.toFixed(0) + "%" : "n/a"}, rss ${rssMb.toFixed(0)}MB, heap ${heapPercent.toFixed(0)}%, loopLag ${loopLagMs.toFixed(0)}ms)`);
      if (trips >= consecutiveTrips) {
        if (memoryWatchdogRestartHeld()) {
          debugLog(`restart deferred (${watchdogRestartHold.reason}): ${breaches.join(", ")} (machine ${machine ? machine.percent.toFixed(0) + "%" : "n/a"}, rss ${rssMb.toFixed(0)}MB, heap ${heapPercent.toFixed(0)}%, loopLag ${loopLagMs.toFixed(0)}ms)`);
        } else {
          const metrics = `machine ${machine ? machine.usedMb.toFixed(0) + "/" + machine.totalMb.toFixed(0) + "MB" : "n/a"}, heap ${heapUsedMb.toFixed(0)}/${heapLimitMb.toFixed(0)}MB, rss ${rssMb.toFixed(0)}MB, loopLag ${loopLagMs.toFixed(0)}ms`;
          console.error(`[memory-watchdog] restarting: ${breaches.join(", ")} — exiting so Fly restarts a fresh machine (${metrics}).`);
          clearInterval(timer);
          void exitAfterWatchdogAlert(breaches, metrics);
        }
      }
    } else if (trips > 0) {
      trips = 0;
    }
  }, intervalMs);
  timer.unref();
  debugLog(`memory watchdog started: interval ${intervalMs}ms, machine>=${machinePercentLimit}%, heap>=${heapPercentLimit}%, rss>=${rssMbLimit > 0 ? rssMbLimit + "MB" : "off"}, loopLag>=${loopLagMsLimit}ms, trips=${consecutiveTrips}, heapLimit=${heapLimitMb.toFixed(0)}MB, machineTotal=${machineAtStart ? machineAtStart.totalMb.toFixed(0) + "MB" : "n/a"}`);
}
