import expect from "expect";
import { afterEach, describe, it } from "mocha";
import { forgetMachineSuspends, machineWasSuspendedAt, notifyMachineResumed, onMachineResume, recordMachineSuspend } from "./machine-suspend";

describe("machine suspend windows", () => {
  afterEach(() => forgetMachineSuspends());

  it("knows a scheduled slot fell while the machine was asleep", () => {
    recordMachineSuspend({suspendedFrom: 1000, resumedAt: 5000});
    expect(machineWasSuspendedAt(3000)).toBe(true);
  });

  it("does not excuse a slot missed while the machine was awake", () => {
    recordMachineSuspend({suspendedFrom: 1000, resumedAt: 5000});
    expect(machineWasSuspendedAt(6000)).toBe(false);
    expect(machineWasSuspendedAt(500)).toBe(false);
  });

  it("runs every resume listener, even when one of them fails", async () => {
    const ran: string[] = [];
    onMachineResume(async () => { throw new Error("fictional failure"); });
    onMachineResume(async () => { ran.push("catch-up"); });
    await notifyMachineResumed();
    expect(ran).toEqual(["catch-up"]);
  });
});
