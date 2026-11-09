import debug from "debug";
import { isArray, isNumber, isString } from "es-toolkit/compat";
import { DateTime } from "luxon";
import { SYSTEM_LOG_LIMIT, SystemLogLine, stripAnsi, systemLogPrefix } from "../../../projects/ngx-ramblers/src/app/models/system-log.model";
import { FlyTargetApp } from "../../../projects/ngx-ramblers/src/app/models/health.model";
import { envConfig } from "../env-config/env-config";
import { flyAuthorizationHeader, missingFlyConfig } from "./fly-env";
import { flyRuntimeConfig } from "./fly-runtime-config";
import { dateTimeNow } from "../shared/dates";

const debugLog = debug(envConfig.logNamespace("fly:logs"));
debugLog.enabled = true;

const FLY_LOGS_API = "https://api.fly.io/api/v1";
const MAX_LOG_PAGES = 40;
const RECENT_LOG_WINDOW_MS = 2 * 60 * 60 * 1000;

interface FlyLogAttributes {
  timestamp?: string | number;
  message?: string;
  instance?: string;
  level?: string;
}

interface FlyLogsResponse {
  data?: {id?: string; attributes?: FlyLogAttributes}[];
  meta?: {next_token?: string};
}

function nanosToken(millis: number): string {
  return `${Math.floor(millis)}000000`;
}

export async function flyAppLogs(environmentName: string | null, fromMillis: number, toMillis: number): Promise<SystemLogLine[]> {
  const {apiToken, appName} = await flyRuntimeConfig(FlyTargetApp.ENVIRONMENT, environmentName);
  const missing = missingFlyConfig({FLY_API_TOKEN: apiToken, FLY_APP_NAME: appName});
  if (missing) {
    throw new Error(`Fly logs are not configured for this environment (missing ${missing})`);
  } else {
    debugLog(`Querying Fly logs for ${appName} from ${fromMillis} to ${toMillis}`);
    const recentFrom = fromMillis > toMillis - RECENT_LOG_WINDOW_MS ? fromMillis : toMillis - RECENT_LOG_WINDOW_MS;
    const recent = await pageFlyLogs(appName, apiToken, nanosToken(recentFrom), fromMillis, toMillis, [], MAX_LOG_PAGES);
    if (recent.length) {
      return recent;
    } else if (recentFrom > fromMillis) {
      const paged = await pageFlyLogs(appName, apiToken, nanosToken(fromMillis), fromMillis, toMillis, [], MAX_LOG_PAGES);
      if (paged.length) {
        return paged;
      } else {
        debugLog(`No logs in range for ${appName}; fetching latest page without a start token`);
        return pageFlyLogs(appName, apiToken, "", fromMillis, toMillis, [], 1);
      }
    } else {
      debugLog(`No logs in range for ${appName}; fetching latest page without a start token`);
      return pageFlyLogs(appName, apiToken, "", fromMillis, toMillis, [], 1);
    }
  }
}

async function pageFlyLogs(
  appName: string,
  apiToken: string,
  nextToken: string,
  fromMillis: number,
  toMillis: number,
  collected: SystemLogLine[],
  pagesLeft: number
): Promise<SystemLogLine[]> {
  if (pagesLeft <= 0) {
    return collected.slice(-SYSTEM_LOG_LIMIT);
  } else {
    const query = nextToken ? `?next_token=${encodeURIComponent(nextToken)}` : "";
    const url = `${FLY_LOGS_API}/apps/${encodeURIComponent(appName)}/logs${query}`;
    const response = await fetch(url, {headers: {Authorization: flyAuthorizationHeader(apiToken)}});
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Fly logs failed for ${appName}: ${response.status} ${text}`.trim());
    } else {
      const body: FlyLogsResponse = await response.json();
      const entries = isArray(body.data) ? body.data : [];
      const followingToken = body.meta?.next_token || "";
      debugLog(`Fly logs page for ${appName}: ${entries.length} entries, next_token ${followingToken || "(none)"}`);
      const mapped = entries.map(entry => lineFromFlyLog(entry.attributes || {}));
      const inRange = mapped.filter(line => line.at >= fromMillis && line.at <= toMillis);
      const next = [...collected, ...inRange].slice(-SYSTEM_LOG_LIMIT);
      const lastAt = mapped.length ? mapped[mapped.length - 1].at : 0;
      if (!followingToken || !entries.length || lastAt > toMillis) {
        return next.slice(-SYSTEM_LOG_LIMIT);
      } else {
        return pageFlyLogs(appName, apiToken, followingToken, fromMillis, toMillis, next, pagesLeft - 1);
      }
    }
  }
}

function lineFromFlyLog(attributes: FlyLogAttributes): SystemLogLine {
  const raw = (attributes.message || "").trim();
  const stripped = stripAnsi(raw);
  const prefix = systemLogPrefix(stripped);
  return {
    at: millisFromFlyTimestamp(attributes.timestamp),
    namespace: attributes.instance || "fly",
    prefix: prefix === stripped ? "fly" : prefix,
    text: raw
  };
}

function millisFromFlyTimestamp(value: string | number | undefined): number {
  if (isNumber(value) && Number.isFinite(value)) {
    if (value > 1e15) {
      return Math.floor(value / 1e6);
    } else {
      return value;
    }
  } else if (isString(value) && value.trim()) {
    const iso = DateTime.fromISO(value);
    if (iso.isValid) {
      return iso.toMillis();
    } else {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return millisFromFlyTimestamp(numeric);
      } else {
        return dateTimeNow().toMillis();
      }
    }
  } else {
    return dateTimeNow().toMillis();
  }
}

export function currentEnvironmentName(): string {
  return envConfig.env;
}
