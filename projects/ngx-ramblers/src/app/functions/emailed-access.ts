import { isString } from "es-toolkit/compat";
import {
  CommitteeAttachmentPurpose,
  EMAILED_ACCESS_COOKIE,
  EMAILED_ACCESS_KEY_SEPARATOR,
  EMAILED_ACCESS_MAX_KEYS,
  EmailedAccessKey,
  EmailedAccessKeyPayload
} from "../models/committee.model";

export function emailedAccessKeysFromCookieHeader(cookieHeader: string | null | undefined): string[] {
  const cookie = (cookieHeader || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${EMAILED_ACCESS_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.substring(EMAILED_ACCESS_COOKIE.length + 1)) : "";
  return value.split(EMAILED_ACCESS_KEY_SEPARATOR).map(key => key.trim()).filter(key => key.length > 0);
}

export function emailedAccessCookieValue(keys: string[]): string {
  return encodeURIComponent(keys.join(EMAILED_ACCESS_KEY_SEPARATOR));
}

export function decodedEmailedAccessKey(key: string): EmailedAccessKeyPayload | null {
  try {
    const segment = (key || "").split(".")[1] || "";
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return payload?.purpose === CommitteeAttachmentPurpose.EMAILED_ACCESS && isString(payload?.committeeFileId) ? payload : null;
  } catch {
    return null;
  }
}

export function unexpiredEmailedAccessKeys(keys: string[], nowSeconds: number): EmailedAccessKey[] {
  return keys
    .map(key => ({key, payload: decodedEmailedAccessKey(key)}))
    .filter(entry => !!entry.payload && (!entry.payload.exp || entry.payload.exp > nowSeconds));
}

export function mergedEmailedAccessKeys(existing: string[], added: string, nowSeconds: number): string[] {
  const addedPayload = decodedEmailedAccessKey(added);
  const kept = unexpiredEmailedAccessKeys(existing, nowSeconds)
    .filter(entry => entry.key !== added && entry.payload.committeeFileId !== addedPayload?.committeeFileId)
    .map(entry => entry.key);
  const merged = addedPayload ? [...kept, added] : kept;
  return merged.slice(-EMAILED_ACCESS_MAX_KEYS);
}
