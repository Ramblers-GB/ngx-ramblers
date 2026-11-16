import { dateTimeNowAsValue } from "../lib/shared/dates";
import debug from "debug";
import fs from "fs";
import os from "os";
import path from "path";
import { entries } from "../../projects/ngx-ramblers/src/app/functions/object-utils";
import { envConfig } from "../lib/env-config/env-config";
import { Environment } from "../../projects/ngx-ramblers/src/app/models/environment.model";
import { configuredEnvironments } from "../lib/environments/environments-config";
import { DEPLOYMENT_DEFAULTS, FLYIO_DEFAULTS } from "../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { isArray } from "es-toolkit/compat";
import { runCommand } from "../lib/fly/fly-commands";
import { FlyMachineListItem } from "../lib/fly/fly.model";

const debugLog = debug(envConfig.logNamespace("deploy-integration-worker"));
debugLog.enabled = true;

if (require.main === module) {
  void deployIntegrationWorker().then(() => process.exit(0)).catch(error => {
    debugLog("Ramblers upload worker deployment failed:", error);
    process.exit(1);
  });
}

async function deployIntegrationWorker(): Promise<void> {
  if (process.env[Environment.ADMIN_MONGODB_URI]) {
    process.env[Environment.MONGODB_URI] = process.env[Environment.ADMIN_MONGODB_URI];
  }

  const dbConfig = await configuredEnvironments();
  if (!dbConfig?.uploadWorker) {
    throw new Error("No uploadWorker config found in database. Populate Global Settings → Upload Worker Configuration first.");
  }

  const workerConfig = dbConfig.uploadWorker;

  if (!workerConfig.appName) {
    throw new Error("uploadWorker.appName is not set in the database");
  }

  if (workerConfig.apiKey) {
    process.env[Environment.FLY_API_TOKEN] = workerConfig.apiKey;
  }

  const imageRepository = process.env[Environment.INTEGRATION_WORKER_IMAGE_REPOSITORY] || DEPLOYMENT_DEFAULTS.DOCKER_IMAGE.split(":")[0];
  const scaleCount = workerConfig.scaleCount ?? FLYIO_DEFAULTS.SCALE_COUNT;
  const memory = workerConfig.memory || FLYIO_DEFAULTS.MEMORY;
  const imageTag = workerImageTag();
  const image = `${imageRepository}:${imageTag}`;
  const flyTomlPath = path.resolve(__dirname, "../../fly.integration-worker.toml");

  if (!fs.existsSync(flyTomlPath)) {
    throw new Error(`Worker Fly config not found at ${flyTomlPath}`);
  }

  runCommand(`flyctl config validate --config ${flyTomlPath} --app ${workerConfig.appName}`);
  importWorkerSecrets(workerConfig.appName, dbConfig.secrets, workerConfig.sharedSecret, workerConfig.encryptionKey);
  retireWorkerMachines(workerConfig.appName, unmanagedWorkerMachines(listWorkerMachines(workerConfig.appName)));
  runCommand(`flyctl deploy --app ${workerConfig.appName} --config ${flyTomlPath} --image ${image} --strategy rolling --ha=false --wait-timeout 600`);
  runCommand(`flyctl scale count ${scaleCount} --app ${workerConfig.appName} --yes`);
  runCommand(`flyctl scale memory ${memory} --app ${workerConfig.appName}`);
  retireWorkerMachines(workerConfig.appName, workerMachinesToRetire(listWorkerMachines(workerConfig.appName), imageTag));
  assertWorkerFleet(workerConfig.appName, imageTag);
  debugLog(`Deployed Ramblers upload worker ${workerConfig.appName} with image ${image}`);
}

export function parseWorkerMachineList(raw: string): FlyMachineListItem[] {
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return isArray(parsed) ? parsed : [];
}

export function unmanagedWorkerMachines(machines: FlyMachineListItem[]): FlyMachineListItem[] {
  return (machines || []).filter(machine => machine.config?.metadata?.fly_process_group !== "app");
}

export function workerMachinesToRetire(machines: FlyMachineListItem[], imageTag: string): FlyMachineListItem[] {
  return (machines || []).filter(machine => {
    const processGroup = machine.config?.metadata?.fly_process_group;
    const tag = machine.image_ref?.tag || "";
    const unmanaged = processGroup !== "app";
    const staleImage = tag !== imageTag;
    return unmanaged || staleImage;
  });
}

function listWorkerMachines(appName: string): FlyMachineListItem[] {
  return parseWorkerMachineList(runCommand(`flyctl machines list --json --app ${appName}`, true));
}

function retireWorkerMachines(appName: string, machines: FlyMachineListItem[]): void {
  machines.forEach(machine => {
    debugLog(`destroying leftover worker machine ${machine.id} image=${machine.image_ref?.tag || "unknown"} process=${machine.config?.metadata?.fly_process_group || "none"}`);
    runCommand(`flyctl machine destroy ${machine.id} --app ${appName} --force`);
  });
}

function assertWorkerFleet(appName: string, imageTag: string): void {
  const remaining = listWorkerMachines(appName);
  const leftover = workerMachinesToRetire(remaining, imageTag);
  if (remaining.length === 0) {
    throw new Error(`Worker ${appName} has no machines after deploying ${imageTag}`);
  } else if (leftover.length > 0) {
    const detail = leftover.map(machine => `${machine.id}:${machine.image_ref?.tag || "unknown"}`).join(", ");
    throw new Error(`Worker ${appName} still has machines not on ${imageTag}: ${detail}`);
  }
}

export function importWorkerSecrets(
  appName: string,
  globalSecrets: Record<string, string> | undefined,
  sharedSecret: string | undefined,
  encryptionKey: string | undefined
): void {
  const secrets: Record<string, string> = {};

  if (globalSecrets) {
    entries(globalSecrets).forEach(([key, value]) => {
      if (value) {
        secrets[key] = value;
      }
    });
  }

  if (sharedSecret) {
    secrets[Environment.INTEGRATION_WORKER_SHARED_SECRET] = sharedSecret;
  }

  if (encryptionKey) {
    secrets[Environment.INTEGRATION_WORKER_ENCRYPTION_KEY] = encryptionKey;
  }

  if (entries(secrets).length === 0) {
    debugLog("No global or worker secrets in database, skipping worker secrets import");
    return;
  }

  const tempFile = path.join(os.tmpdir(), `integration-worker-secrets-${dateTimeNowAsValue()}.env`);
  const lines = entries(secrets).map(([key, value]) => `${key}=${value}`);

  try {
    fs.writeFileSync(tempFile, lines.join("\n"), { encoding: "utf-8" });
    runCommand(`flyctl secrets import --stage --app ${appName} < ${tempFile}`);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

const WORKER_TAG_PREFIX = "integration-worker-";

function workerImageTag(): string {
  const imageTag = imageTagFromArg();

  if (imageTag.startsWith(WORKER_TAG_PREFIX)) {
    return imageTag;
  }

  if (/^\d+$/.test(imageTag)) {
    const normalisedTag = `${WORKER_TAG_PREFIX}${imageTag}`;
    debugLog(`Image tag ${imageTag} refers to the browserless website image - normalising to ${normalisedTag}`);
    return normalisedTag;
  }

  throw new Error(`Image tag ${imageTag} is not a worker image tag - worker images are pushed as ${WORKER_TAG_PREFIX}<run number>`);
}

function imageTagFromArg(): string {
  const tagArg = process.argv.find(arg => arg.startsWith("--image-tag="));

  if (tagArg) {
    return tagArg.split("=")[1];
  }

  const tagIndex = process.argv.indexOf("--image-tag");

  if (tagIndex !== -1 && process.argv.length > tagIndex + 1) {
    return process.argv[tagIndex + 1];
  }

  throw new Error("An image tag must be supplied via --image-tag");
}
