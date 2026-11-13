import debug from "debug";
import { envConfig } from "../lib/env-config/env-config";
import { configuredEnvironments, estateDeployEnvironments } from "../lib/environments/environments-config";

const debugLog = debug(envConfig.logNamespace("list-environment-names"));
debugLog.enabled = true;

void listEnvironmentNames().then(() => process.exit(0)).catch(error => {
  debugLog("Failed to list environment names:", error);
  process.exit(1);
});

async function listEnvironmentNames(): Promise<void> {
  if (process.env.ADMIN_MONGODB_URI) {
    process.env.MONGODB_URI = process.env.ADMIN_MONGODB_URI;
  }

  const dbConfig = await configuredEnvironments();
  const names = estateDeployEnvironments(dbConfig).map(environment => environment.environment);
  const requested = process.argv[2]?.trim().split(/\s+/) || ["all"];
  const selected = requested.length === 1 && requested.includes("all")
    ? names
    : names.filter(name => requested.includes(name));

  debugLog(`Resolved ${selected.length} eligible deployment targets from database`);
  process.stdout.write(`${JSON.stringify(selected)}\n`);
}
