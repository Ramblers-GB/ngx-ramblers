import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { deviceCanRecordRoutes } from "./route-recording-device";

function view(coarse: boolean): Pick<Window, "matchMedia"> {
  return {matchMedia: (query: string) => ({matches: coarse && query === "(pointer: coarse)"}) as MediaQueryList};
}

describe("deviceCanRecordRoutes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records on phones and tablets, where the main pointer is a finger", () => {
    expect(deviceCanRecordRoutes(view(true))).toBe(true);
  });

  it("does not record on a desktop or laptop", () => {
    expect(deviceCanRecordRoutes(view(false))).toBe(false);
    expect(deviceCanRecordRoutes(null)).toBe(false);
  });

  it("always records in the native app", () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(deviceCanRecordRoutes(view(false))).toBe(true);
  });
});
