import { EventEmitter } from "events";
import { format } from "util";
import { isString } from "es-toolkit/compat";
import createDebug from "debug";
import { SYSTEM_LOG_LIMIT, SystemLogLine, stripAnsi, systemLogPrefix } from "../../../projects/ngx-ramblers/src/app/models/system-log.model";
import { dateTimeNow } from "../shared/dates";
import { redactForLog } from "../env-config/env-config";

const events = new EventEmitter();
const lines: SystemLogLine[] = [];
const capture = {installed: false};

export function appendSystemLog(namespace: string, text: string): SystemLogLine {
  const line: SystemLogLine = {
    at: dateTimeNow().toMillis(),
    namespace,
    prefix: systemLogPrefix(namespace),
    text
  };
  lines.push(line);
  if (lines.length > SYSTEM_LOG_LIMIT) {
    lines.splice(0, lines.length - SYSTEM_LOG_LIMIT);
  }
  events.emit("line", line);
  return line;
}

export function systemLogSnapshot(): SystemLogLine[] {
  return lines.slice();
}

export function clearSystemLogs(): void {
  lines.splice(0, lines.length);
}

export function onSystemLog(listener: (line: SystemLogLine) => void): () => void {
  events.on("line", listener);
  return () => {
    events.off("line", listener);
  };
}

export function installSystemLogCapture(): void {
  if (capture.installed) {
  } else {
    const originalLog = createDebug.log;
    createDebug.log = function(this: {namespace?: string}, ...args: unknown[]) {
      const printable = args.map(value => isString(value) ? redactForLog(stripAnsi(value)) : value);
      originalLog.apply(this, printable);
      const namespace = this?.namespace || "debug";
      if (namespace.includes("system-log")) {
      } else {
        appendSystemLog(namespace, stripAnsi(format(...printable)));
      }
    };
    capture.installed = true;
  }
}
