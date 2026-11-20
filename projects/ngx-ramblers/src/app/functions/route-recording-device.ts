import { Capacitor } from "@capacitor/core";
import { isUndefined } from "es-toolkit/compat";

export function deviceCanRecordRoutes(view: Pick<Window, "matchMedia"> | null = isUndefined(globalThis.window) ? null : globalThis.window): boolean {
  return Capacitor.isNativePlatform() || !!view?.matchMedia?.("(pointer: coarse)")?.matches;
}
