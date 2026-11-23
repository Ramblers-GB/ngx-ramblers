import { SECRET_MASK } from "../../models/config.model";
import { WALKS_MANAGER_ACCESS_MESSAGES, WalksManagerAccess, WalksManagerAccessStatus } from "../../models/walks-manager-access.model";

export function walksManagerAccessWithStatus(status: WalksManagerAccessStatus, detail: string | null = null): WalksManagerAccess {
  return {status, message: detail ? `${WALKS_MANAGER_ACCESS_MESSAGES[status]}: ${detail}` : WALKS_MANAGER_ACCESS_MESSAGES[status]};
}

export function walksManagerAccessFrom(loginRejected: boolean, createMenuShown: boolean, uploadOffered: boolean): WalksManagerAccess {
  if (loginRejected) {
    return walksManagerAccessWithStatus(WalksManagerAccessStatus.LOGIN_FAILED);
  } else if (!createMenuShown) {
    return walksManagerAccessWithStatus(WalksManagerAccessStatus.NOT_CHECKED, "Walks Manager showed neither its Create menu nor a login error after logging in");
  } else if (uploadOffered) {
    return walksManagerAccessWithStatus(WalksManagerAccessStatus.UPLOAD_AVAILABLE);
  } else {
    return walksManagerAccessWithStatus(WalksManagerAccessStatus.NO_UPLOAD_ACCESS);
  }
}

export function walksManagerLoginUnsaved(login: {userName?: string; password?: string}, savedUserName: string | null): boolean {
  return (login?.password || "") !== SECRET_MASK || (login?.userName || "") !== (savedUserName || "");
}
