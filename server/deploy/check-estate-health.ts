import debug from "debug";
import { envConfig } from "../lib/env-config/env-config";
import { configuredEnvironments } from "../lib/environments/environments-config";
import { BuildVersion } from "../../projects/ngx-ramblers/src/app/models/build-version.model";
import { EstateHealthResult } from "./deploy.model";
import { pluraliseWithCount } from "../lib/shared/string-utils";
import { environmentAsleep } from "../lib/fly/fly-machines";
import { EnvironmentConfig, flyAppNameFor } from "../../projects/ngx-ramblers/src/app/models/environment-config.model";

const debugLog = debug(envConfig.logNamespace("estate-health"));
debugLog.enabled = true;

void checkEstateHealth().then(() => process.exit(0)).catch(error => {
  debugLog("Estate health check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

async function checkEnvironment(environmentConfig: EnvironmentConfig, appName: string): Promise<EstateHealthResult> {
  const environment = environmentConfig.environment;
  const url = `https://${appName}.fly.dev/api/version`;
  if (await environmentAsleep(environmentConfig, appName)) {
    return {environment, url, healthy: true, detail: "asleep, not woken to check it"};
  } else {
    return checkVersion(environment, url);
  }
}

async function checkVersion(environment: string, url: string): Promise<EstateHealthResult> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) {
      return {environment, url, healthy: false, detail: `HTTP ${response.status}`};
    } else {
      const buildVersion: BuildVersion = await response.json();
      if (buildVersion.buildNumber) {
        return {environment, url, healthy: true, detail: `build ${buildVersion.buildNumber}`};
      } else {
        return {environment, url, healthy: false, detail: "no buildNumber in response"};
      }
    }
  } catch (error) {
    return {environment, url, healthy: false, detail: error instanceof Error ? error.message : String(error)};
  }
}

async function checkEstateHealth(): Promise<void> {
  if (process.env.ADMIN_MONGODB_URI) {
    process.env.MONGODB_URI = process.env.ADMIN_MONGODB_URI;
  }
  const dbConfig = await configuredEnvironments();
  const { disconnect } = await import("../lib/mongo/mongoose-client");
  await disconnect(debugLog);
  const targets = (dbConfig?.environments || []).map(environmentConfig => ({
    environmentConfig,
    appName: flyAppNameFor(environmentConfig)
  }));
  debugLog("Checking", pluraliseWithCount(targets.length, "environment"));
  const firstPass = await Promise.all(targets.map(target => checkEnvironment(target.environmentConfig, target.appName)));
  const retryTargets = targets.filter((_target, index) => !firstPass[index].healthy);
  const retriedResults: EstateHealthResult[] = retryTargets.length === 0 ? [] : await new Promise(resolve => setTimeout(resolve, 10000))
    .then(() => Promise.all(retryTargets.map(target => checkEnvironment(target.environmentConfig, target.appName))));
  const finalResults = firstPass.map(result => retriedResults.find(retried => retried.environment === result.environment) || result);
  finalResults.forEach(result => debugLog(`${result.healthy ? "✅" : "❌"} ${result.environment}: ${result.detail} (${result.url})`));
  const failures = finalResults.filter(result => !result.healthy);
  if (failures.length > 0) {
    throw new Error(`${pluraliseWithCount(failures.length, "unhealthy environment")} of ${finalResults.length}: ${failures.map(failure => `${failure.environment} (${failure.detail})`).join(", ")}`);
  }
  debugLog(`All ${finalResults.length} environments healthy`);
}
