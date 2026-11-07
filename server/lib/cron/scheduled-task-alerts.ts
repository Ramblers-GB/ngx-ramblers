import debug from "debug";
import { toPairs } from "es-toolkit/compat";
import { AdminSettingsPath } from "../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";
import {
  SCHEDULED_TASK_SUB_TAB_GROUPS,
  ScheduledTaskSubTab
} from "../../../projects/ngx-ramblers/src/app/models/scheduled-task.model";
import { StoredValue } from "../../../projects/ngx-ramblers/src/app/models/ui-actions";
import { envConfig } from "../env-config/env-config";
import { notifyAdminIncident } from "../alerts/admin-alerts";
import { siteBaseUrl } from "../config/site-base-url";

const debugLog = debug(envConfig.logNamespace("cron:scheduled-task-alerts"));
debugLog.enabled = true;

export enum ScheduledTaskProblem {
  FAILED = "failed",
  MISSED = "missed",
  INCOMPLETE = "incomplete",
  STOPPED_RESTARTED = "stopped-restarted"
}

export interface ScheduledTaskAlert {
  taskId: string;
  taskName: string;
  problem: ScheduledTaskProblem;
  message: string;
  details?: string | null;
}

function scheduledTaskSubTab(taskId: string): string {
  const parent = toPairs(SCHEDULED_TASK_SUB_TAB_GROUPS)
    .find(([, children]) => (children as string[]).includes(taskId));
  return parent ? parent[0] : ScheduledTaskSubTab.ALL;
}

export function scheduledTasksAdminPath(taskId: string): string {
  const tab = "scheduled-tasks";
  const subTab = scheduledTaskSubTab(taskId);
  return `${AdminSettingsPath.SYSTEM_SETTINGS}?${StoredValue.TAB}=${encodeURIComponent(tab)}&${StoredValue.TASK_SUB_TAB}=${encodeURIComponent(subTab)}`;
}

export async function scheduledTasksAdminUrl(taskId: string): Promise<string | null> {
  const base = await siteBaseUrl();
  if (!base) {
    return null;
  }
  return `${base}/${scheduledTasksAdminPath(taskId)}`;
}

function problemTitle(problem: ScheduledTaskProblem): string {
  if (problem === ScheduledTaskProblem.FAILED) {
    return "Scheduled task failed";
  } else if (problem === ScheduledTaskProblem.MISSED) {
    return "Scheduled task missed its run";
  } else if (problem === ScheduledTaskProblem.INCOMPLETE) {
    return "Scheduled task interrupted";
  } else {
    return "Scheduled task cron was stopped";
  }
}

export async function notifyPlatformAdminsOfScheduledTaskProblem(alert: ScheduledTaskAlert): Promise<void> {
  const adminUrl = await scheduledTasksAdminUrl(alert.taskId);
  const title = problemTitle(alert.problem);
  const sent = await notifyAdminIncident({
    subject: `[NGX platform] ${title}: ${alert.taskName}`,
    category: `scheduled-task:${alert.problem}`,
    title,
    intro: "A scheduled task problem was detected on the platform admin environment.",
    items: [
      {label: "Task", value: `${alert.taskName} (${alert.taskId})`},
      {label: "Problem", value: alert.problem}
    ],
    message: alert.message,
    details: alert.details,
    actionUrl: adminUrl,
    actionLabel: "Open Scheduled Tasks",
    actionHint: "Admin → System Settings → Scheduled Tasks",
    actionFooter: "for history and manual runs."
  });
  if (!sent) {
    debugLog(`Scheduled task alert not sent for "${alert.taskId}" (${alert.problem})`);
  }
}
