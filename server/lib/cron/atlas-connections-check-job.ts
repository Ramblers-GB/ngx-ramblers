import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { registerScheduledTask } from "./scheduled-task-registry";
import { ScheduledTaskId } from "../../../projects/ngx-ramblers/src/app/models/scheduled-task.model";
import { AdminPlatformPath } from "../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";
import { StoredValue } from "../../../projects/ngx-ramblers/src/app/models/ui-actions.model";
import {
  ATLAS_CONNECTION_LIMIT,
  ATLAS_CONNECTION_WARNING_PERCENT,
  AtlasClusterRow,
  ConnectionWindow,
  EnvironmentAtlasTab,
  atlasAlertLabel,
  connectionPercent,
  connectionsNearLimit,
  openAtlasAlerts
} from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { atlasClusterConnectionHealth } from "../environment-setup/atlas-clusters";
import { dateTimeNowAsValue } from "../shared/dates";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";

const debugLog = debug(envConfig.logNamespace("cron:atlas-connections-check"));
debugLog.enabled = true;

const REPEAT_WARNING_MS = 6 * 60 * 60 * 1000;
const lastWarnedAt = new Map<string, number>();

function platformAdminEnabled(): boolean {
  return process.env.PLATFORM_ADMIN_ENABLED === "true";
}

export function clustersNeedingAttention(clusters: AtlasClusterRow[]): AtlasClusterRow[] {
  return clusters.filter(cluster => connectionsNearLimit(cluster) || openAtlasAlerts(cluster).length > 0);
}

function clusterSummary(cluster: AtlasClusterRow): string {
  const limit = ATLAS_CONNECTION_LIMIT[cluster.instanceSize];
  const connections = cluster.connections
    ? `busiest minute ${cluster.connections.peak}${limit ? ` of ${limit} (${connectionPercent(cluster)}%)` : ""}, ${cluster.connections.current} now`
    : "connections not available";
  const alerts = openAtlasAlerts(cluster).map(atlasAlertLabel);
  return [connections, alerts.length ? `open Atlas alerts: ${alerts.join(", ")}` : null, cluster.environmentNames ? `sites: ${cluster.environmentNames}` : null]
    .filter(part => !!part)
    .join("; ");
}

export async function runAtlasConnectionsCheck(): Promise<void> {
  if (!platformAdminEnabled()) {
    debugLog("Atlas connections check skipped - PLATFORM_ADMIN_ENABLED is not true on this environment");
  } else {
    const clusters = await atlasClusterConnectionHealth(ConnectionWindow.LAST_QUARTER_HOUR);
    const now = dateTimeNowAsValue();
    const attention = clustersNeedingAttention(clusters);
    const due = attention.filter(cluster => now - (lastWarnedAt.get(cluster.host) || 0) > REPEAT_WARNING_MS);
    debugLog("Atlas connections check: %d clusters checked, %d need attention, %d due a warning", clusters.length, attention.length, due.length);
    clusters.filter(cluster => !attention.includes(cluster)).forEach(cluster => lastWarnedAt.delete(cluster.host));
    if (due.length > 0) {
      const base = await siteBaseUrlModule.siteBaseUrl();
      const sent = await adminAlerts.notifyAdminIncident({
        subject: `[NGX ${envConfig.env}] MongoDB Atlas connections near the limit on ${due.map(cluster => cluster.name).join(", ")}`,
        category: "atlas-connections",
        title: "MongoDB Atlas connections near the limit",
        intro: `In the last 15 minutes ${due.length === 1 ? "this cluster has" : "these clusters have"} used ${ATLAS_CONNECTION_WARNING_PERCENT}% or more of the connections Atlas allows, or Atlas has an open alert. When the limit is reached, sites on the cluster cannot open new database connections.`,
        items: due.map(cluster => ({label: cluster.name, value: clusterSummary(cluster)})),
        message: "Check the cluster's connection chart on the MongoDB Atlas page. If one cluster holds many sites, move some to another cluster with Environment Migration.",
        actionUrl: base ? `${base}/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_ATLAS}?${StoredValue.TAB}=${EnvironmentAtlasTab.CLUSTERS}` : null,
        actionLabel: "Open MongoDB Atlas",
        actionHint: "Admin → Platform Admin → MongoDB Atlas → Clusters",
        actionFooter: "for each cluster's connections."
      });
      if (sent) {
        due.forEach(cluster => lastWarnedAt.set(cluster.host, now));
      } else {
        debugLog("Atlas connections warning not sent");
      }
    }
  }
}

export async function scheduleAtlasConnectionsCheck(): Promise<void> {
  const cronExpression = "*/10 * * * *";
  await registerScheduledTask({
    id: ScheduledTaskId.ATLAS_CONNECTIONS_CHECK,
    name: "MongoDB Atlas connections check",
    description: `Checks every Atlas cluster's connections and open Atlas alerts, and emails the admin alert recipients when a cluster reaches ${ATLAS_CONNECTION_WARNING_PERCENT}% of its connection limit, at most once every 6 hours per cluster. Only runs on platform-admin environments.`,
    cronExpression,
    enabled: true,
    runtimeEnabled: platformAdminEnabled,
    run: runAtlasConnectionsCheck
  });
  debugLog(`Atlas connections check registered: ${cronExpression} (${platformAdminEnabled() ? "enabled" : "platform admin not enabled - registered for UI visibility only"})`);
}
