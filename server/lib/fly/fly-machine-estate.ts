import { isArray } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import debug from "debug";
import { FlyAppDeployment, FlyDeployStrategy, FlyMachineEstate, FlyMachineListItem, FlyMachineRelease, FlyMachineTarget } from "./fly.model";
import { OutputCallback, parseMemoryMb, runCommand, runCommandStreaming, runCommandWithRetry, sleep } from "./fly-commands";
import { dateTimeNowAsValue } from "../shared/dates";
import { pluraliseWithCount } from "../shared/string-utils";

const debugLog = debug(envConfig.logNamespace("fly-machine-estate"));
debugLog.enabled = true;

const FLY_PROCESS_GROUP_APP = "app";

function releaseMachineTarget(imageRef: string, version: number): FlyMachineTarget {
  const digest = imageRef.match(/(?:@|^)(sha256:[a-f0-9]+)$/i)?.[1];
  const imageName = imageRef.slice(imageRef.lastIndexOf("/") + 1);
  const imageTag = imageName.split(":")[1] || "latest";
  if (digest) {
    return {imageDigest: digest};
  } else if (imageTag === "latest") {
    return {imageTag, releaseVersion: String(version)};
  } else {
    return {imageTag};
  }
}

export function parseFlyMachineList(raw: string): FlyMachineListItem[] {
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return isArray(parsed) ? parsed : [];
}

function listFlyMachines(appName: string): FlyMachineListItem[] {
  return parseFlyMachineList(runCommand(`flyctl machines list --json --app ${appName}`, true));
}

function isAppMachine(machine: FlyMachineListItem): boolean {
  return machine.config?.metadata?.fly_process_group === FLY_PROCESS_GROUP_APP;
}

function isDeploymentMachine(machine: FlyMachineListItem, target: FlyMachineTarget): boolean {
  return isAppMachine(machine)
    && (!target.releaseVersion || machine.config?.metadata?.fly_release_version === target.releaseVersion)
    && (target.imageDigest
    ? machine.image_ref?.digest === target.imageDigest
    : !target.imageTag || machine.image_ref?.tag === target.imageTag);
}

export function machinesToRetire(
  machines: FlyMachineListItem[],
  options: FlyMachineEstate
): FlyMachineListItem[] {
  const estate = machines || [];
  const staleOrUnmanaged = estate.filter(machine => !isDeploymentMachine(machine, options));
  const keepers = estate
    .filter(machine => isDeploymentMachine(machine, options))
    .sort((left, right) => {
      const leftRank = machineReadinessRank(left);
      const rightRank = machineReadinessRank(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      } else {
        return (left.id || "").localeCompare(right.id || "");
      }
    });
  const extras = keepers.slice(Math.max(options.scaleCount, 0));
  return staleOrUnmanaged.concat(extras);
}

function retireFlyMachines(appName: string, machines: FlyMachineListItem[]): void {
  machines.forEach(machine => {
    debugLog(`destroying leftover machine ${machine.id} app=${appName} image=${machine.image_ref?.tag || "unknown"} process=${machine.config?.metadata?.fly_process_group || "none"} state=${machine.state || "unknown"}`);
    runCommand(`flyctl machine destroy ${machine.id} --app ${appName} --force`);
  });
}

function assertFlyMachineEstate(appName: string, options: FlyMachineEstate): void {
  const remaining = listFlyMachines(appName);
  const leftover = machinesToRetire(remaining, options);
  if (leftover.length > 0) {
    const detail = leftover.map(machine => `${machine.id}:${machine.image_ref?.tag || "unknown"}`).join(", ");
    throw new Error(`Fly app ${appName} still has leftover machines: ${detail}`);
  } else if (remaining.length !== options.scaleCount) {
    throw new Error(`Fly app ${appName} has ${remaining.length} machines, expected ${options.scaleCount}`);
  } else {
    assertReplacementsReady(appName, remaining, options);
  }
}

export function parseFlyReleaseList(raw: string): FlyMachineRelease[] {
  const parsed = raw.trim() ? JSON.parse(raw) : [];
  return isArray(parsed) ? parsed : [];
}

function completedRelease(appName: string): FlyMachineRelease {
  const releases = parseFlyReleaseList(runCommand(`flyctl releases --json --app ${appName}`, true));
  const latest = releases[0];
  if (!latest) {
    throw new Error(`Fly app ${appName} has no releases after deploy`);
  } else if ((latest.Status || "").toLowerCase() !== "complete") {
    throw new Error(`Fly app ${appName} latest release v${latest.Version} is ${latest.Status}`);
  } else if (!latest.ImageRef?.trim()) {
    throw new Error(`Fly app ${appName} release v${latest.Version} has no image reference`);
  } else {
    return latest;
  }
}

export const FLY_READY_MACHINE_STATES = ["started", "stopped", "suspended"];

function machineReadinessRank(machine: FlyMachineListItem): number {
  if (machine.state === "started") {
    return 0;
  } else {
    return FLY_READY_MACHINE_STATES.includes(machine.state || "") ? 1 : 2;
  }
}

export function readyReplacementMachines(machines: FlyMachineListItem[], options: FlyMachineTarget): FlyMachineListItem[] {
  return (machines || []).filter(machine => isDeploymentMachine(machine, options) && FLY_READY_MACHINE_STATES.includes(machine.state || ""));
}

export function assertReplacementsReady(appName: string, machines: FlyMachineListItem[], options: FlyMachineEstate): void {
  const ready = readyReplacementMachines(machines, options);
  if (ready.length < options.scaleCount) {
    const detail = (machines || []).map(machine => `${machine.id}:${machine.image_ref?.tag || "unknown"}:${machine.state || "unknown"}`).join(", ");
    throw new Error(`Fly app ${appName} has ${pluraliseWithCount(ready.length, "ready machine")} on ${options.imageDigest || options.imageTag || "the deployed image"}, needs ${options.scaleCount} (${detail})`);
  }
}

export async function deployFlyApp(deployment: FlyAppDeployment, onDeployOutput?: OutputCallback): Promise<void> {
  const {appName, configPath, image, memory, remoteOnly, scaleCount, strategy = FlyDeployStrategy.ROLLING} = deployment;
  if (!Number.isInteger(scaleCount) || scaleCount < 1) {
    throw new Error(`Fly app ${appName} deployment requires a positive machine count, received ${scaleCount}`);
  }
  const memoryMb = memory ? parseMemoryMb(memory) : null;
  const command = [
    `flyctl deploy --app ${appName} --config ${configPath}`,
    image ? `--image ${image}` : null,
    memoryMb ? `--vm-memory ${memoryMb}` : null,
    remoteOnly ? "--remote-only" : null,
    `--strategy ${strategy} --ha=false --wait-timeout 600`
  ].filter(Boolean).join(" ");
  await runCommandWithRetry(command, command => runCommandStreaming(command, onDeployOutput));
  const release = completedRelease(appName);
  const estate = {...releaseMachineTarget(release.ImageRef.trim(), release.Version), scaleCount};
  await ensureScale(appName, estate, memoryMb);
  const machines = listFlyMachines(appName);
  const currentRelease = completedRelease(appName);
  if (currentRelease.Version !== release.Version) {
    throw new Error(`Fly app ${appName} changed from release v${release.Version} to v${currentRelease.Version} during scaling`);
  }
  assertReplacementsReady(appName, machines, estate);
  retireFlyMachines(appName, machinesToRetire(machines, estate));
  assertFlyMachineEstate(appName, estate);
}

async function waitForReadyAppMachines(appName: string, options: FlyMachineEstate, deadline: number): Promise<FlyMachineListItem[]> {
  const machines = listFlyMachines(appName);
  const ready = readyReplacementMachines(machines, options);
  if (ready.length < options.scaleCount && dateTimeNowAsValue() < deadline) {
    await sleep(3000);
    return waitForReadyAppMachines(appName, options, deadline);
  } else {
    assertReplacementsReady(appName, machines, options);
    return ready;
  }
}

async function ensureScale(appName: string, options: FlyMachineEstate, targetMemoryMb: number | null): Promise<void> {
  const machines = listFlyMachines(appName);
  const managed = machines.filter(isAppMachine);
  const ready = readyReplacementMachines(machines, options);
  const deadline = dateTimeNowAsValue() + 90000;
  const replacements = ready.length === 0 && managed.length > 0 && options.scaleCount > 0
    ? await waitForReadyAppMachines(appName, {...options, scaleCount: 1}, deadline)
    : ready;
  if (replacements.length < options.scaleCount) {
    if (ready.length === managed.length) {
      await runCommandWithRetry(`flyctl scale count ${options.scaleCount} --app ${appName} --process-group ${FLY_PROCESS_GROUP_APP} --yes`);
    } else {
      const source = replacements.find(machine => machine.state === "started") || replacements[0];
      Array.from({length: options.scaleCount - replacements.length}).forEach(() => runCommand(`flyctl machine clone ${source.id} --app ${appName}`));
    }
    const scaled = await waitForReadyAppMachines(appName, options, deadline);
    await ensureEstateMemory(appName, scaled, targetMemoryMb);
  } else {
    await ensureEstateMemory(appName, replacements, targetMemoryMb);
  }
}

async function ensureEstateMemory(appName: string, machines: FlyMachineListItem[], targetMemoryMb: number | null): Promise<void> {
  if (targetMemoryMb && machines.some(machine => machine.config?.guest?.memory_mb !== targetMemoryMb)) {
    await runCommandWithRetry(`flyctl scale memory ${targetMemoryMb} --app ${appName} --process-group ${FLY_PROCESS_GROUP_APP}`);
  }
}
