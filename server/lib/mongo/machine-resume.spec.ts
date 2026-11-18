import expect from "expect";
import { describe, it } from "mocha";
import { MACHINE_RESUME_GAP_MS, MACHINE_RESUME_TICK_MS, resumedAfter } from "./machine-resume";

describe("machine resume detection", () => {
  const lastTickAt = 1_000_000;

  it("treats normal ticks as the machine still running", () => {
    expect(resumedAfter(lastTickAt, lastTickAt + MACHINE_RESUME_TICK_MS)).toBe(false);
  });

  it("does not mistake a busy event loop for a resume", () => {
    expect(resumedAfter(lastTickAt, lastTickAt + 60000)).toBe(false);
  });

  it("recognises a machine woken after a suspend of several minutes", () => {
    expect(resumedAfter(lastTickAt, lastTickAt + MACHINE_RESUME_GAP_MS + 1)).toBe(true);
    expect(resumedAfter(lastTickAt, lastTickAt + 18 * 60 * 1000)).toBe(true);
  });
});
