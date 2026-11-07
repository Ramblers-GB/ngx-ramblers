import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";
import {
  holdMemoryWatchdogRestart,
  memoryWatchdogRestartHeld,
  notifyMemoryWatchdogRestart,
  releaseMemoryWatchdogRestart
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
});
