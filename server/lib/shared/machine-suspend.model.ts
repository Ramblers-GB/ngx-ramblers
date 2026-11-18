export interface MachineSuspendWindow {
  suspendedFrom: number;
  resumedAt: number;
}

export type MachineResumeListener = () => Promise<void>;
