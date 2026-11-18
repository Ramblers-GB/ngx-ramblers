import expect from "expect";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import { ChildProcess } from "child_process";
import { LocalDevFrontendSession, LocalRunConfig } from "./cli.model";
import { EventEmitter } from "events";
import { runLocalDevEnvironments, signalLocalProcess, stopLocalProcess } from "./local-process-lifecycle";

const sandbox = sinon.createSandbox();

function childProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {pid: 123456, exitCode: null, signalCode: null}) as ChildProcess;
}

function stubProcessGroup() {
  const state = {alive: true, ignoreTermination: false};
  const kill = sandbox.stub(process, "kill").callsFake((_pid, signal) => {
    if (signal === 0) {
      if (!state.alive) {
        throw Object.assign(new Error("No such process"), {code: "ESRCH"});
      }
    } else if (signal === "SIGKILL" || (signal === "SIGTERM" && !state.ignoreTermination)) {
      state.alive = false;
    }
    return true;
  });
  return {state, kill, signals: () => kill.args.filter(args => args[1] !== 0)};
}

describe("local development process lifecycle", () => {
  afterEach(() => sandbox.restore());

  it("stops the whole process group so a watcher cannot leave its server behind", async () => {
    const group = stubProcessGroup();
    await stopLocalProcess(childProcess());
    expect(group.signals()).toEqual([[-123456, "SIGTERM"]]);
  });

  it("does not signal a process group that has already exited", async () => {
    const group = stubProcessGroup();
    group.state.alive = false;
    const child = childProcess();
    Object.defineProperty(child, "exitCode", {value: 0});
    await stopLocalProcess(child);
    signalLocalProcess(child, "SIGTERM");
    expect(group.signals()).toEqual([]);
  });

  it("escalates if the process has received SIGTERM but has not exited", async () => {
    const clock = sandbox.useFakeTimers();
    const group = stubProcessGroup();
    group.state.ignoreTermination = true;
    const stopped = stopLocalProcess(childProcess());
    clock.tick(4000);
    await stopped;
    expect(group.signals()).toEqual([[-123456, "SIGTERM"], [-123456, "SIGKILL"]]);
  });

  it("keeps waiting and escalates after the parent exits with surviving descendants", async () => {
    const clock = sandbox.useFakeTimers();
    const group = stubProcessGroup();
    group.state.ignoreTermination = true;
    const child = childProcess();
    const completion = {finished: false};
    const stopped = stopLocalProcess(child).then(() => completion.finished = true);
    Object.defineProperty(child, "signalCode", {value: "SIGTERM"});
    child.emit("exit", null, "SIGTERM");
    clock.tick(25);
    await Promise.resolve();
    expect(completion.finished).toBe(false);
    clock.tick(3975);
    await stopped;
    expect(group.signals()).toEqual([[-123456, "SIGTERM"], [-123456, "SIGKILL"]]);
    expect(completion.finished).toBe(true);
  });

  it("cleans up surviving descendants when the parent had already exited before shutdown", async () => {
    const child = childProcess();
    Object.defineProperty(child, "exitCode", {value: 0});
    const group = stubProcessGroup();
    await stopLocalProcess(child);
    expect(group.signals()).toEqual([[-123456, "SIGTERM"]]);
  });
});

describe("switching local development environments", () => {
  afterEach(() => sandbox.restore());

  const config: LocalRunConfig = {environmentName: "hillside", mode: "dev", port: 5001, logDir: null, logTimestamp: false, logViewer: false, s3BucketOverride: false};

  it("reuses the same Angular process across environment choices and stops it on exit", async () => {
    const child = childProcess();
    const calls: LocalDevFrontendSession[] = [];
    const environments: string[] = [];
    const group = stubProcessGroup();
    const choose = sandbox.stub().resolves("riverside");
    await runLocalDevEnvironments(config, async (selected, frontend) => {
      calls.push(frontend);
      environments.push(selected.environmentName);
      frontend.child = child;
      expect(selected.port).toBe(5001);
      expect(selected.s3BucketOverride).toBe(false);
      return selected.environmentName === "hillside";
    }, choose);
    expect(environments).toEqual(["hillside", "riverside"]);
    expect(calls[0]).toBe(calls[1]);
    expect(choose.calledOnce).toBe(true);
    expect(group.signals()).toEqual([[-123456, "SIGTERM"]]);
  });

  it("stops when the environment chooser is cancelled", async () => {
    const run = sandbox.stub().resolves(true);
    const choose = sandbox.stub().resolves(null);
    await runLocalDevEnvironments(config, run, choose);
    expect(run.calledOnce).toBe(true);
  });
});
