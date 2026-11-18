import fs from "fs";
import { spawn, spawnSync } from "child_process";
import { LogViewerConfig } from "./cli.model";
import { log } from "./cli-logger";

function waitForLogFiles(config: LogViewerConfig, timeoutMs = 30000): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      clearInterval(poll);
      clearTimeout(timeout);
      config.signal?.removeEventListener("abort", finish);
      resolve();
    };
    const check = () => {
      if (config.signal?.aborted || fs.existsSync(config.frontendLogPath) || fs.existsSync(config.backendLogPath)) {
        finish();
      }
    };
    const poll = setInterval(check, 100);
    const timeout = setTimeout(finish, timeoutMs);
    config.signal?.addEventListener("abort", finish, {once: true});
    check();
  });
}

function stopSecondaryLogs(config: LogViewerConfig): void {
  [config.backendLogPath, config.workerLogPath].filter(Boolean).forEach(logPath => {
    spawnSync("pkill", ["-f", `tail -f ${logPath}`], {stdio: "ignore"});
  });
}

function followFrontendLog(config: LogViewerConfig, onClose: (() => void) | null = null): Promise<void> {
  return new Promise((resolve, reject) => {
    const tail = spawn("tail", ["-f", config.frontendLogPath], {stdio: "inherit"});
    const cancel = () => tail.kill("SIGTERM");
    const finish = (error: Error | null) => {
      config.signal?.removeEventListener("abort", cancel);
      tail.removeListener("exit", exited);
      tail.removeListener("error", failed);
      onClose?.();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const exited = () => finish(null);
    const failed = (error: Error) => finish(error);
    tail.once("exit", exited);
    tail.once("error", failed);
    config.signal?.addEventListener("abort", cancel, {once: true});
    if (config.signal?.aborted) {
      cancel();
    }
  });
}

function isTmuxAvailable(): boolean {
  const result = spawnSync("which", ["tmux"], { stdio: "ignore" });
  return result.status === 0;
}

export function logViewerSupported(): boolean {
  return process.platform === "darwin" || isTmuxAvailable();
}

function openWithTmux(config: LogViewerConfig): Promise<void> {
  spawnSync("tmux", ["split-window", "-h", "tail", "-f", config.backendLogPath]);

  if (config.workerLogPath) {
    spawnSync("tmux", ["split-window", "-v", "-t", ".", "tail", "-f", config.workerLogPath]);
  }

  return followFrontendLog(config, () => stopSecondaryLogs(config));
}

function openWithIterm(config: LogViewerConfig): Promise<void> {
  const workerSplit = config.workerLogPath
    ? `
        set workerSession to (split horizontally with default profile)
        tell workerSession
          write text "exec tail -f '${config.workerLogPath}'"
        end tell`
    : "";

  const script = `
    tell application "iTerm2"
      tell current session of current window
        set backendSession to (split vertically with default profile)
        tell backendSession
          write text "exec tail -f '${config.backendLogPath}'"${workerSplit}
        end tell
      end tell
    end tell
  `;
  spawnSync("osascript", ["-e", script]);

  const killSplitPane = () => stopSecondaryLogs(config);
  process.on("SIGINT", killSplitPane);
  process.on("SIGTERM", killSplitPane);
  process.on("exit", killSplitPane);

  return followFrontendLog(config, () => {
    process.removeListener("SIGINT", killSplitPane);
    process.removeListener("SIGTERM", killSplitPane);
    process.removeListener("exit", killSplitPane);
    killSplitPane();
  });
}

function openWithTerminalApp(config: LogViewerConfig): Promise<void> {
  const backendScript = `
    tell application "Terminal"
      activate
      do script "tail -f '${config.backendLogPath}'"
    end tell
  `;
  spawnSync("osascript", ["-e", backendScript]);

  if (config.workerLogPath) {
    const workerScript = `
      tell application "Terminal"
        activate
        do script "tail -f '${config.workerLogPath}'"
      end tell
    `;
    spawnSync("osascript", ["-e", workerScript]);
  }

  return followFrontendLog(config, () => stopSecondaryLogs(config));
}

export async function openLogViewer(config: LogViewerConfig): Promise<void> {
  if (!config.signal?.aborted) {
    if (!fs.existsSync(config.frontendLogPath) && !fs.existsSync(config.backendLogPath)) {
      log("Waiting for log files...");
      await waitForLogFiles(config);
    }
    if (!config.signal?.aborted) {
      if (!fs.existsSync(config.frontendLogPath) && !fs.existsSync(config.backendLogPath)) {
        log("No log files found after waiting.");
      } else if (isTmuxAvailable()) {
        await openWithTmux(config);
      } else if ((process.env.TERM_PROGRAM || "").includes("iTerm")) {
        await openWithIterm(config);
      } else {
        await openWithTerminalApp(config);
      }
    }
  }
}
