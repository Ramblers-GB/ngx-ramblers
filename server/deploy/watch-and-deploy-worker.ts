import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import debug from "debug";
import { envConfig } from "../lib/env-config/env-config";
import { dateTimeNowAsValue } from "../lib/shared/dates";
import { configuredEnvironments } from "../lib/environments/environments-config";
import { applyFlyOrganisationToken } from "./fly-org-token";

const debugLog = debug(envConfig.logNamespace("watch-and-deploy-worker"));
debugLog.enabled = true;

const REPO_ROOT = path.resolve(__dirname, "../..");
const WATCH_DIRS = [
  path.resolve(__dirname, "../lib"),
  path.resolve(__dirname, "../../projects/ngx-ramblers/src/app")
];
const DEBOUNCE_MS = 3000;
export const PROD_WORKER_APP = "ngx-ramblers-integration-worker";

function confirmDeploy(reason: string, appName: string, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    const cancel = () => rl.close();
    signal.addEventListener("abort", cancel, {once: true});
    rl.once("close", () => {
      signal.removeEventListener("abort", cancel);
      resolve(false);
    });
    rl.question(`Change in ${reason} - rebuild and deploy to ${appName}? This is a full Docker image build. (y/N) `, answer => {
      resolve(/^y/i.test(answer.trim()));
      rl.close();
    });
  });
}

export async function watchAndDeployWorker(appName: string = PROD_WORKER_APP): Promise<() => void> {
  applyFlyOrganisationToken(await configuredEnvironments());

  const lifecycle = new AbortController();
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let deploying = false;
  let awaitingConfirmation = false;
  let pendingReason: string | null = null;

  function runDeploy(): void {
    deploying = true;
    const startedAt = dateTimeNowAsValue();
    const child = spawn("flyctl", ["deploy", "--app", appName, "--config", "fly.integration-worker.toml", "--remote-only"], {cwd: REPO_ROOT, stdio: "inherit"});
    child.on("exit", code => {
      deploying = false;
      const seconds = ((dateTimeNowAsValue() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        debugLog(`Deployed to ${appName} in ${seconds}s`);
      } else {
        debugLog(`Deploy failed after ${seconds}s (exit code ${code})`);
      }
      maybeTriggerPending();
    });
  }

  function maybeTriggerPending(): void {
    if (pendingReason && !lifecycle.signal.aborted) {
      const reason = pendingReason;
      pendingReason = null;
      void triggerDeploy(reason);
    }
  }

  async function triggerDeploy(reason: string): Promise<void> {
    if (deploying || awaitingConfirmation) {
      pendingReason = reason;
      debugLog(`Change in ${reason} while busy - queued`);
    } else {
      awaitingConfirmation = true;
      const confirmed = await confirmDeploy(reason, appName, lifecycle.signal);
      awaitingConfirmation = false;
      if (confirmed && !lifecycle.signal.aborted) {
        runDeploy();
      } else {
        debugLog("Skipped");
        maybeTriggerPending();
      }
    }
  }

  function scheduleDeploy(fileName: string): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void triggerDeploy(fileName), DEBOUNCE_MS);
  }

  let watching = 0;
  WATCH_DIRS.forEach(dir => {
    if (fs.existsSync(dir)) {
      watchers.push(fs.watch(dir, {recursive: true}, (_event, fileName) => {
        if (fileName && fileName.endsWith(".ts")) {
          scheduleDeploy(fileName);
        }
      }));
      watching++;
      debugLog(`Watching ${dir}`);
    }
  });

  if (watching === 0) {
    throw new Error("No watch directories found - nothing to watch");
  }

  debugLog(`Ready - edits will prompt to deploy to ${appName} ${DEBOUNCE_MS / 1000}s after the last change`);
  return () => {
    lifecycle.abort();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    watchers.forEach(watcher => watcher.close());
  };
}

if (require.main === module) {
  void watchAndDeployWorker();
}
