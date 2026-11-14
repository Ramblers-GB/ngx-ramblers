import debug from "debug";
import { NextFunction, Request, Response } from "express";
import { isError } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { AdminPlatformPath } from "../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";
import { ProcessErrorKind } from "../../../projects/ngx-ramblers/src/app/models/health.model";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";
import { dateTimeNowAsValue } from "../shared/dates";

const debugLog = debug(envConfig.logNamespace("process-error-handling"));
debugLog.enabled = true;

const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const REQUEST_ERROR_MESSAGE = "The site hit an unexpected error. Try again.";
const installed = {value: false};
const lastAlertAt = {value: 0};

export function processErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  } else {
    return String(error);
  }
}

export function processErrorDetails(error: unknown): string {
  if (isError(error)) {
    return [error.name, error.message, error.stack].filter(Boolean).join("\n");
  } else {
    return String(error);
  }
}

export function shouldSendProcessErrorAlert(nowMs: number, lastSentAtMs: number, throttleMs: number): boolean {
  return nowMs - lastSentAtMs >= throttleMs;
}

export async function notifyProcessError(kind: ProcessErrorKind, error: unknown): Promise<boolean> {
  const nowMs = dateTimeNowAsValue();
  if (!shouldSendProcessErrorAlert(nowMs, lastAlertAt.value, ALERT_THROTTLE_MS)) {
    debugLog(`process error alert throttled (${kind}):`, processErrorMessage(error));
    return false;
  } else {
    lastAlertAt.value = nowMs;
    const base = await siteBaseUrlModule.siteBaseUrl();
    const actionUrl = base ? `${base}/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_HEALTH}` : null;
    const appName = envConfig.value(Environment.FLY_APP_NAME) || envConfig.value(Environment.APP_NAME) || "(none)";
    const sent = await adminAlerts.notifyAdminIncident({
      subject: `[NGX ${envConfig.env}] Unhandled ${kind} - process stayed up`,
      category: `process-error:${kind}`,
      title: "Unhandled process error",
      intro: "An unhandled error was caught so the HTTP server can keep serving. The site stayed up.",
      items: [
        {label: "Environment", value: envConfig.env},
        {label: "App", value: appName},
        {label: "Kind", value: kind}
      ],
      message: processErrorMessage(error),
      details: processErrorDetails(error),
      actionUrl,
      actionLabel: "Open Environments Monitoring",
      actionHint: "Admin → Environment management → Environments Monitoring",
      actionFooter: "for machine health."
    });
    if (!sent) {
      debugLog(`process error alert not sent (${kind})`);
    }
    return sent;
  }
}

function onUnhandledRejection(reason: unknown): void {
  debugLog("unhandledRejection:", processErrorDetails(reason));
  void notifyProcessError(ProcessErrorKind.UNHANDLED_REJECTION, reason).catch(alertError => {
    debugLog("unhandledRejection alert failed:", processErrorMessage(alertError));
  });
}

function onUncaughtException(error: unknown): void {
  debugLog("uncaughtException:", processErrorDetails(error));
  void notifyProcessError(ProcessErrorKind.UNCAUGHT_EXCEPTION, error).catch(alertError => {
    debugLog("uncaughtException alert failed:", processErrorMessage(alertError));
  });
}

export function installProcessErrorHandlers(): void {
  if (!installed.value) {
    process.on("unhandledRejection", onUnhandledRejection);
    process.on("uncaughtException", onUncaughtException);
    installed.value = true;
    debugLog("process error handlers installed");
  }
}

export function productionRequestErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  debugLog("unhandled request error", req.method, req.path, processErrorDetails(error));
  void notifyProcessError(ProcessErrorKind.REQUEST, error).catch(alertError => {
    debugLog("request error alert failed:", processErrorMessage(alertError));
  });
  if (res.headersSent) {
    next(error);
  } else if ((req.path || "").startsWith("/api")) {
    res.status(500).json({error: {message: REQUEST_ERROR_MESSAGE}});
  } else {
    res.status(500).send(REQUEST_ERROR_MESSAGE);
  }
}
