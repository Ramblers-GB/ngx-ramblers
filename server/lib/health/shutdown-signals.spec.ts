import expect from "expect";
import { describe, it } from "mocha";
import { recordStoppedRunsThenExit } from "./shutdown-signals";

describe("shutdown signals", () => {
  it("records stopped scheduled task runs and then exits cleanly", async () => {
    const calls: string[] = [];
    await recordStoppedRunsThenExit("SIGTERM", async () => {
      calls.push("recorded");
      return 1;
    }, code => calls.push(`exit ${code}`));
    expect(calls).toEqual(["recorded", "exit 0"]);
  });

  it("still exits when recording fails", async () => {
    const exits: number[] = [];
    await recordStoppedRunsThenExit("SIGINT", () => Promise.reject(new Error("database unavailable")), code => exits.push(code));
    expect(exits).toEqual([0]);
  });

  it("still exits when recording takes longer than the time limit", async () => {
    const exits: number[] = [];
    await recordStoppedRunsThenExit("SIGINT", () => new Promise<number>(() => null), code => exits.push(code), 20);
    expect(exits).toEqual([0]);
  });
});
