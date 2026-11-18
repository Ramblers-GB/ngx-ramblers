import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { FlyMachineMode } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { FlyAppConfigOptions } from "./fly.model";

export function nativeMailTlsConfiguration(configuration: string): string {
  return configuration.split("[[services]]").map((section, index) => index > 0 && /\bport\s*=\s*(465|993)\b/.test(section)
    ? section.replace(/handlers\s*=\s*\[["']tls["']\]/g, "handlers = []")
      .replace(/^\s*tls_options\s*=\s*\{[^\r\n]*\}\r?\n/gm, "\n")
    : section).join("[[services]]");
}

export function sleepWhenIdleConfiguration(configuration: string): string {
  return configuration
    .replace(/^(\s*auto_stop_machines\s*=\s*).*$/gm, (_line, setting) => `${setting}"suspend"`)
    .replace(/^(\s*min_machines_running\s*=\s*).*$/gm, (_line, setting) => `${setting}0`);
}

export function flyAppConfiguration(configuration: string, options: FlyAppConfigOptions): string {
  const withMailTls = options.nativeMailTls ? nativeMailTlsConfiguration(configuration) : configuration;
  return options.flyMachines === FlyMachineMode.SLEEP_WHEN_IDLE ? sleepWhenIdleConfiguration(withMailTls) : withMailTls;
}

export function flyAppConfigNeedsRewrite(options: FlyAppConfigOptions): boolean {
  return options.nativeMailTls || options.flyMachines === FlyMachineMode.SLEEP_WHEN_IDLE;
}

export async function withFlyAppConfiguration(source: string, options: FlyAppConfigOptions, deploy: (configurationPath: string) => Promise<void>): Promise<void> {
  if (flyAppConfigNeedsRewrite(options)) {
    const temporary = path.join(os.tmpdir(), `fly-app-config-${randomUUID()}.toml`);
    try {
      fs.writeFileSync(temporary, flyAppConfiguration(fs.readFileSync(source, "utf8"), options));
      await deploy(temporary);
    } finally {
      if (fs.existsSync(temporary)) {
        fs.unlinkSync(temporary);
      }
    }
  } else {
    await deploy(source);
  }
}
