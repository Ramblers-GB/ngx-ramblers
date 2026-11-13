import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";
import { WatchdogExitDecision } from "../../../projects/ngx-ramblers/src/app/models/health.model";
import {
  decideWatchdogExit,
  emptyWatchdogRestartHistory,
  holdMemoryWatchdogRestart,
  memoryWatchdogRestartHeld,
  notifyMemoryWatchdogRestart,
  notifyMemoryWatchdogRestartLoop,
  pruneWatchdogRestartHistory,
  releaseMemoryWatchdogRestart,
  watchdogRestartHistoryFromUnknown
} from "./memory-watchdog";

describe("memory watchdog restart hold", () => {
  afterEach(() => {
    releaseMemoryWatchdogRestart();
    releaseMemoryWatchdogRestart();
  });

  it("holds and releases a restart", () => {
    expect(memoryWatchdogRestartHeld()).toEqual(false);
    holdMemoryWatchdogRestart("backup");
    expect(memoryWatchdogRestartHeld()).toEqual(true);
    releaseMemoryWatchdogRestart();
    expect(memoryWatchdogRestartHeld()).toEqual(false);
  });

  it("requires matching releases for nested holds", () => {
    holdMemoryWatchdogRestart("outer");
    holdMemoryWatchdogRestart("inner");
    releaseMemoryWatchdogRestart();
    expect(memoryWatchdogRestartHeld()).toEqual(true);
    releaseMemoryWatchdogRestart();
    expect(memoryWatchdogRestartHeld()).toEqual(false);
  });

  it("emails the same admin incident template as scheduled-task failures", async () => {
    const sandbox = sinon.createSandbox();
    sandbox.stub(siteBaseUrlModule, "siteBaseUrl").resolves("https://group.example.org.uk");
    const notify = sandbox.stub(adminAlerts, "notifyAdminIncident").resolves(true);
    await notifyMemoryWatchdogRestart(["loopLag 8800ms"], "heap 270/2752MB, rss 636MB, loopLag 8800ms");
    expect(notify.calledOnce).toEqual(true);
    const request = notify.firstCall.args[0];
    expect(request.category).toEqual("memory-watchdog:restart");
    expect(request.title).toEqual("Memory watchdog restarting the process");
    expect(request.subject).toContain("Memory watchdog restarting the process");
    expect(request.details).toContain("loopLag 8800ms");
    expect(request.actionLabel).toEqual("Open Environments Monitoring");
    expect(request.actionUrl).toContain("environment-management/health");
    sandbox.restore();
  });

  it("emails once when a restart loop is suppressed", async () => {
    const sandbox = sinon.createSandbox();
    sandbox.stub(siteBaseUrlModule, "siteBaseUrl").resolves("https://group.example.org.uk");
    const notify = sandbox.stub(adminAlerts, "notifyAdminIncident").resolves(true);
    await notifyMemoryWatchdogRestartLoop(["heap 92% (2400/2608MB)"], "machine 875/965MB, heap 2400/2608MB, rss 707MB, loopLag 266ms", 2, 30 * 60 * 1000);
    expect(notify.calledOnce).toEqual(true);
    const request = notify.firstCall.args[0];
    expect(request.category).toEqual("memory-watchdog:restart-loop");
    expect(request.title).toEqual("Memory watchdog restart loop suppressed");
    expect(request.subject).toContain("restart loop suppressed");
    expect(request.items.some(item => item.label === "Restarts in window" && item.value === "2 in 30 minutes")).toEqual(true);
    sandbox.restore();
  });
});

describe("memory watchdog restart decision", () => {
  it("holds while a backup is running", () => {
    expect(decideWatchdogExit({
      held: true,
      nowMs: 200000,
      startedAtMs: 0,
      graceMs: 120000,
      recentRestartCount: 0,
      maxRestarts: 2,
      fatalBreach: true
    })).toEqual(WatchdogExitDecision.HELD);
  });

  it("waits out the startup grace period", () => {
    expect(decideWatchdogExit({
      held: false,
      nowMs: 60000,
      startedAtMs: 0,
      graceMs: 120000,
      recentRestartCount: 0,
      maxRestarts: 2,
      fatalBreach: true
    })).toEqual(WatchdogExitDecision.STARTUP_GRACE);
  });

  it("keeps the process up when only machine memory is high", () => {
    expect(decideWatchdogExit({
      held: false,
      nowMs: 180000,
      startedAtMs: 0,
      graceMs: 120000,
      recentRestartCount: 0,
      maxRestarts: 2,
      fatalBreach: false
    })).toEqual(WatchdogExitDecision.MACHINE_PRESSURE);
  });

  it("exits after grace when the restart budget remains", () => {
    expect(decideWatchdogExit({
      held: false,
      nowMs: 180000,
      startedAtMs: 0,
      graceMs: 120000,
      recentRestartCount: 1,
      maxRestarts: 2,
      fatalBreach: true
    })).toEqual(WatchdogExitDecision.EXIT);
  });

  it("suppresses a restart loop once the budget is spent", () => {
    expect(decideWatchdogExit({
      held: false,
      nowMs: 180000,
      startedAtMs: 0,
      graceMs: 120000,
      recentRestartCount: 2,
      maxRestarts: 2,
      fatalBreach: true
    })).toEqual(WatchdogExitDecision.RESTART_LOOP);
  });

  it("prunes restart stamps outside the window", () => {
    const pruned = pruneWatchdogRestartHistory({
      restarts: [1, 1000, 2000],
      lastLoopAlertAt: 500
    }, 2500, 1000);
    expect(pruned).toEqual({restarts: [2000], lastLoopAlertAt: null});
  });

  it("reads an empty history from unknown input", () => {
    expect(watchdogRestartHistoryFromUnknown(null)).toEqual(emptyWatchdogRestartHistory());
    expect(watchdogRestartHistoryFromUnknown({restarts: ["x", 12], lastLoopAlertAt: "nope"})).toEqual({
      restarts: [12],
      lastLoopAlertAt: null
    });
  });
});
