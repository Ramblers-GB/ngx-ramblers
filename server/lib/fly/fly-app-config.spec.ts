import expect from "expect";
import { describe, it } from "mocha";
import { readFileSync } from "fs";
import { resolveClientPath } from "../shared/path-utils";
import { FlyMachineMode } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { flyAppConfiguration, nativeMailTlsConfiguration, sleepWhenIdleConfiguration, withFlyAppConfiguration } from "./fly-app-config";

const original = () => readFileSync(resolveClientPath("fly.toml"), "utf8");

describe("per-environment Fly app configuration", () => {
  it("changes only the mail TLS handlers for an explicitly enabled deployment", () => {
    const updated = nativeMailTlsConfiguration(original());
    expect(updated.split("handlers = []")).toHaveLength(3);
    expect(updated.split("[[services]]")[0]).toBe(original().split("[[services]]")[0]);
    expect(updated.replaceAll("handlers = []", "handlers = [\"tls\"]")).toBe(original());
  });

  it("lets every service suspend and scale to zero when sleeping when idle", () => {
    const updated = sleepWhenIdleConfiguration(original());
    expect(updated.match(/auto_stop_machines = "suspend"/g)).toHaveLength(3);
    expect(updated.match(/min_machines_running = 0/g)).toHaveLength(3);
    expect(updated).not.toMatch(/auto_stop_machines = false/);
    expect(updated).not.toMatch(/min_machines_running = 1/);
    expect(updated.match(/auto_start_machines = true/g)).toHaveLength(3);
  });

  it("leaves the repository configuration unchanged for an always-on site", () => {
    expect(flyAppConfiguration(original(), {nativeMailTls: false, flyMachines: FlyMachineMode.ALWAYS_ON})).toBe(original());
  });

  it("applies mail TLS and sleep together", () => {
    const updated = flyAppConfiguration(original(), {nativeMailTls: true, flyMachines: FlyMachineMode.SLEEP_WHEN_IDLE});
    expect(updated.split("handlers = []")).toHaveLength(3);
    expect(updated.match(/min_machines_running = 0/g)).toHaveLength(3);
  });

  it("uses the original deployment configuration when nothing needs rewriting", async () => {
    const paths: string[] = [];
    await withFlyAppConfiguration("fictional-fly.toml", {nativeMailTls: false, flyMachines: FlyMachineMode.ALWAYS_ON}, async source => {paths.push(source);});
    expect(paths).toEqual(["fictional-fly.toml"]);
  });
});
