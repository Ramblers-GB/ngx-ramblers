export enum WalksManagerAccessStatus {
  QUEUED = "queued",
  UPLOAD_AVAILABLE = "upload-available",
  LOGIN_FAILED = "login-failed",
  NO_UPLOAD_ACCESS = "no-upload-access",
  NOT_CHECKED = "not-checked"
}

export interface WalksManagerAccess {
  status: WalksManagerAccessStatus;
  message: string;
}

export interface WalksManagerAccessJobResult extends WalksManagerAccess {
  jobId: string;
  createdAt: number;
  completedAt: number | null;
}

export interface WalksManagerAccessRequest {
  userName: string;
  password: string;
}

export const WALKS_MANAGER_ACCESS_FILE = "walks-manager-access.json";
export const WALKS_MANAGER_ACCESS_POLL_MS = 3000;
export const WALKS_MANAGER_ACCESS_MAX_WAIT_MS = 5 * 60 * 1000;
export const WALKS_MANAGER_LOGIN_SETTLE_SECONDS = 30;

export const WALKS_MANAGER_ACCESS_MESSAGES: Record<WalksManagerAccessStatus, string> = {
  [WalksManagerAccessStatus.QUEUED]: "Checking the Walks Manager login",
  [WalksManagerAccessStatus.UPLOAD_AVAILABLE]: "Logged in to Walks Manager and the Create menu offers the walks CSV upload, so this login can upload walks.",
  [WalksManagerAccessStatus.LOGIN_FAILED]: "Walks Manager did not accept this user name and password.",
  [WalksManagerAccessStatus.NO_UPLOAD_ACCESS]: "Logged in to Walks Manager, but this user cannot upload walks: the Create menu does not offer the walks CSV upload. Ask Ramblers to give this user walk upload access for the group, or use a different login.",
  [WalksManagerAccessStatus.NOT_CHECKED]: "The Walks Manager login could not be checked"
};

export const WALKS_MANAGER_ACCESS_TITLES: Record<WalksManagerAccessStatus, string> = {
  [WalksManagerAccessStatus.QUEUED]: "Checking",
  [WalksManagerAccessStatus.UPLOAD_AVAILABLE]: "This login can upload walks",
  [WalksManagerAccessStatus.LOGIN_FAILED]: "Login rejected",
  [WalksManagerAccessStatus.NO_UPLOAD_ACCESS]: "Logged in, but no upload access",
  [WalksManagerAccessStatus.NOT_CHECKED]: "Login not checked"
};

export const WALKS_MANAGER_ACCESS_ALERT_CLASSES: Record<WalksManagerAccessStatus, string> = {
  [WalksManagerAccessStatus.QUEUED]: "alert-warning",
  [WalksManagerAccessStatus.UPLOAD_AVAILABLE]: "alert-success",
  [WalksManagerAccessStatus.LOGIN_FAILED]: "alert-danger",
  [WalksManagerAccessStatus.NO_UPLOAD_ACCESS]: "alert-danger",
  [WalksManagerAccessStatus.NOT_CHECKED]: "alert-warning"
};
