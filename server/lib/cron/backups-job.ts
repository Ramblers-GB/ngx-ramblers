import debug from "debug";
import {
  ScheduledTaskId,
  BACKUPS_TASK_NAME,
  DEFAULT_BACKUPS_TASK_SETTINGS
} from "../../../projects/ngx-ramblers/src/app/models/scheduled-task.model";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { envConfig } from "../env-config/env-config";
import { booleanOf } from "../shared/string-utils";
import { registerScheduledTask } from "./scheduled-task-registry";
import { backupAllEnvironments, scheduledBackupSettings } from "./backups-run";
import {
  integrationWorkerBackupsAvailable,
  runAllEnvironmentsBackupOnIntegrationWorker
} from "../ramblers/integration-worker-backups-client";

const debugLog = debug(envConfig.logNamespace("cron:backups"));
debugLog.enabled = true;

function platformAdminEnabled(): boolean {
  return booleanOf(process.env[Environment.PLATFORM_ADMIN_ENABLED]);
}

function flyRuntimeAvailable(): boolean {
  return Boolean(process.env[Environment.FLY_MACHINE_ID]);
}

export function platformBackupSchedulerEnabled(): boolean {
  return platformAdminEnabled()
    && process.env[Environment.NODE_ENV] === "production"
    && flyRuntimeAvailable();
}

export { backupAllEnvironments };

async function runScheduledBackup(): Promise<void> {
  if (integrationWorkerBackupsAvailable() && (await scheduledBackupSettings()).uploadMongoDumpToS3ByDefault) {
    debugLog("Dispatching all-environments backup to the integration worker");
    await runAllEnvironmentsBackupOnIntegrationWorker();
  } else {
    debugLog("Running all-environments backup in-process");
    await backupAllEnvironments({holdWatchdog: true});
  }
}

export async function scheduleBackups(): Promise<void> {
  const cronExpression = "0 3 * * *";
  await registerScheduledTask({
    id: ScheduledTaskId.BACKUPS,
    name: BACKUPS_TASK_NAME,
    description: "Backs up every configured environment's MongoDB database and S3 objects to the shared backup bucket. Runs on the integration worker when configured and MongoDB dumps are uploaded to S3. Only scheduled on platform-admin environments.",
    cronExpression,
    enabled: true,
    previousIds: ["all-environments-backup"],
    runtimeEnabled: platformBackupSchedulerEnabled,
    settings: DEFAULT_BACKUPS_TASK_SETTINGS,
    run: async () => {
      if (!platformBackupSchedulerEnabled()) {
        debugLog(`${Environment.PLATFORM_ADMIN_ENABLED}, ${Environment.NODE_ENV}=production and Fly runtime are required - skipping run on this environment`);
      } else {
        debugLog("Starting scheduled all-environments backup");
        await runScheduledBackup();
      }
    }
  });
  debugLog(`All-environments backup cron job registered: ${cronExpression} (daily at 3am; ${platformBackupSchedulerEnabled() ? "platform backup scheduler enabled" : "platform backup scheduler not enabled - registered for UI visibility only"})`);
}
