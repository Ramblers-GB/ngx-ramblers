import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { MachineResumeListener, MachineSuspendWindow } from "./machine-suspend.model";

const debugLog = debug(envConfig.logNamespace("machine-suspend"));
debugLog.enabled = true;

const MAXIMUM_REMEMBERED_WINDOWS = 20;

const suspendState = {
  windows: [] as MachineSuspendWindow[],
  listeners: [] as MachineResumeListener[]
};

export function recordMachineSuspend(window: MachineSuspendWindow): void {
  suspendState.windows = [...suspendState.windows, window].slice(-MAXIMUM_REMEMBERED_WINDOWS);
}

export function machineWasSuspendedAt(timestamp: number): boolean {
  return suspendState.windows.some(window => timestamp >= window.suspendedFrom && timestamp <= window.resumedAt);
}

export function onMachineResume(listener: MachineResumeListener): void {
  suspendState.listeners = [...suspendState.listeners, listener];
}

export async function notifyMachineResumed(): Promise<void> {
  await Promise.all(suspendState.listeners.map(listener => listener().catch(error => debugLog("A task to run after the machine resumed failed:", error?.message || error))));
}

export function forgetMachineSuspends(): void {
  suspendState.windows = [];
  suspendState.listeners = [];
}
