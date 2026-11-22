import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { EnvironmentConfig, flyAppNameFor } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { SiteDatabaseState } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { DeploymentInfo } from "../../../projects/ngx-ramblers/src/app/models/build-version.model";
import { databaseFingerprint } from "../shared/database-fingerprint";
import { environmentAsleep } from "../fly/fly-machines";

const debugLog = debug(envConfig.logNamespace("site-database-check"));
debugLog.enabled = true;

export const SITE_DATABASE_CHECK_TIMEOUT_MS = 8000;
export const SITE_DATABASE_CONFIRM_ATTEMPTS = 24;
export const SITE_DATABASE_CONFIRM_INTERVAL_MS = 5000;

async function reportedFingerprint(environment: EnvironmentConfig): Promise<string | null> {
  try {
    const response = await fetch(`https://${flyAppNameFor(environment)}.fly.dev/api/version/details`, {signal: AbortSignal.timeout(SITE_DATABASE_CHECK_TIMEOUT_MS)});
    const details: Partial<DeploymentInfo> = response.ok ? await response.json() : {};
    return details.databaseFingerprint || null;
  } catch (error) {
    debugLog("Could not read the running database of %s: %s", environment.environment, error instanceof Error ? error.message : error);
    return null;
  }
}

export function siteDatabaseStateFrom(reported: string | null, cluster: string | null | undefined, database: string | null | undefined): SiteDatabaseState {
  const expected = databaseFingerprint(cluster, database);
  if (!reported || !expected) {
    return SiteDatabaseState.UNKNOWN;
  } else if (reported === expected) {
    return SiteDatabaseState.MATCHES;
  } else {
    return SiteDatabaseState.DIFFERS;
  }
}

export async function runningSiteDatabaseState(environment: EnvironmentConfig, cluster: string | null | undefined, database: string | null | undefined): Promise<SiteDatabaseState> {
  if (await environmentAsleep(environment, flyAppNameFor(environment))) {
    return SiteDatabaseState.ASLEEP;
  } else {
    return siteDatabaseStateFrom(await reportedFingerprint(environment), cluster, database);
  }
}

export async function confirmRunningSiteDatabase(environment: EnvironmentConfig, cluster: string, database: string, attemptsLeft = SITE_DATABASE_CONFIRM_ATTEMPTS, intervalMs = SITE_DATABASE_CONFIRM_INTERVAL_MS): Promise<SiteDatabaseState> {
  const state = siteDatabaseStateFrom(await reportedFingerprint(environment), cluster, database);
  if (state === SiteDatabaseState.MATCHES || attemptsLeft <= 1) {
    return state;
  } else {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    return confirmRunningSiteDatabase(environment, cluster, database, attemptsLeft - 1, intervalMs);
  }
}
