import { ChildProcess } from "child_process";
import { LocalDevFrontendSession, LocalRunConfig } from "./cli.model";
import { log } from "./cli-logger";

function localProcessRunning(child: ChildProcess): boolean {
  if (!child.pid) {
    return false;
  } else if (process.platform === "win32") {
    return child.exitCode === null && child.signalCode === null;
  } else {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return false;
      } else {
        log("Could not check local process group %s: %s", child.pid, (error as Error).message);
        return true;
      }
    }
  }
}

export function signalLocalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (localProcessRunning(child)) {
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        log("Could not stop local process %s: %s", child.pid, (error as Error).message);
      }
    }
  }
}

export function stopLocalProcess(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (!localProcessRunning(child)) {
      resolve();
    } else {
      const escalation = setTimeout(() => signalLocalProcess(child, "SIGKILL"), 4000);
      const checkStopped = () => {
        if (localProcessRunning(child)) {
          setTimeout(checkStopped, 25);
        } else {
          clearTimeout(escalation);
          resolve();
        }
      };
      signalLocalProcess(child, "SIGTERM");
      checkStopped();
    }
  });
}

export async function runLocalDevEnvironments(config: LocalRunConfig, runEnvironment: (config: LocalRunConfig, frontend: LocalDevFrontendSession) => Promise<boolean>, chooseEnvironment: () => Promise<string | null>): Promise<void> {
  const frontend: LocalDevFrontendSession = {child: null, logPath: null, onError: (label, message) => log("%s: %s", label, message)};
  const stopFrontend = () => {
    if (frontend.child) {
      signalLocalProcess(frontend.child, "SIGTERM");
    }
  };
  process.once("exit", stopFrontend);
  const environments = [config.environmentName];
  try {
    for (const selectedEnvironment of environments) {
      const chooseAnother = await runEnvironment({...config, environmentName: selectedEnvironment}, frontend);
      if (chooseAnother) {
        const nextEnvironment = await chooseEnvironment();
        if (nextEnvironment) {
          environments.push(nextEnvironment);
        }
      }
    }
  } finally {
    process.removeListener("exit", stopFrontend);
    if (frontend.child) {
      await stopLocalProcess(frontend.child);
    }
  }
}
