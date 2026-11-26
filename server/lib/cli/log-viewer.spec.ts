import expect from "expect";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";
import fs from "fs";
import childProcesses from "child_process";
import { EventEmitter } from "events";
import { LogViewerConfig } from "./cli.model";
import { openLogViewer } from "./log-viewer";
import { runLocalDevEnvironments } from "./local-process-lifecycle";

const sandbox = sinon.createSandbox();
const config: LogViewerConfig = {frontendLogPath: "/tmp/hillside-frontend.log", backendLogPath: "/tmp/hillside-backend.log", workerLogPath: "/tmp/hillside-worker.log", refreshIntervalMs: 500, maxLines: 2000};

function stubLogViewer() {
  const tail = Object.assign(new EventEmitter(), {kill: sandbox.stub()});
  tail.kill.callsFake(() => {
    queueMicrotask(() => tail.emit("exit", null, "SIGTERM"));
    return true;
  });
  const spawn = sandbox.stub(childProcesses, "spawn").returns(tail as any);
  const spawnSync = sandbox.stub(childProcesses, "spawnSync").returns({status: 1} as any);
  const exists = sandbox.stub(fs, "existsSync").returns(true);
  return {tail, spawn, spawnSync, exists};
}

describe("log viewer cancellation", () => {
  beforeEach(() => sandbox.stub(process, "env").value({...process.env, TERM_PROGRAM: "iTerm.app"}));
  afterEach(() => sandbox.restore());

  it("terminates the foreground tail and removes signal handlers when cancelled", async () => {
    const viewer = stubLogViewer();
    const cancellation = new AbortController();
    const before = {interrupt: process.listenerCount("SIGINT"), terminate: process.listenerCount("SIGTERM"), exit: process.listenerCount("exit")};
    const opened = openLogViewer({...config, signal: cancellation.signal});
    await new Promise<void>(resolve => {
      const attempt = {n: 0};
      const tick = () => {
        if (viewer.spawn.called || attempt.n >= 20) {
          resolve();
        } else {
          attempt.n += 1;
          setImmediate(tick);
        }
      };
      tick();
    });
    cancellation.abort();
    await opened;
    expect(viewer.tail.kill.args).toEqual([["SIGTERM"]]);
    expect(process.listenerCount("SIGINT")).toBe(before.interrupt);
    expect(process.listenerCount("SIGTERM")).toBe(before.terminate);
    expect(process.listenerCount("exit")).toBe(before.exit);
    expect(viewer.spawnSync.getCalls().some(call => call.args[0] === "pkill")).toBe(true);
  });

  it("does not launch a viewer after cancellation", async () => {
    const viewer = stubLogViewer();
    const cancellation = new AbortController();
    cancellation.abort();
    await openLogViewer({...config, signal: cancellation.signal});
    expect(viewer.spawn.called).toBe(false);
    expect(viewer.spawnSync.called).toBe(false);
  });

  it("cancels while waiting for logs without leaving polling timers", async () => {
    const clock = sandbox.useFakeTimers();
    const viewer = stubLogViewer();
    viewer.exists.returns(false);
    const output = sandbox.stub(console, "log");
    const cancellation = new AbortController();
    const opened = openLogViewer({...config, signal: cancellation.signal});
    cancellation.abort();
    await opened;
    clock.tick(30000);
    expect(output.calledWith("Waiting for log files...")).toBe(true);
    expect(viewer.spawn.called).toBe(false);
    expect(viewer.spawnSync.called).toBe(false);
  });

  it("allows environment cleanup to release Angular when a failure cancels the viewer", async () => {
    stubLogViewer();
    const cancellation = new AbortController();
    const angular = Object.assign(new EventEmitter(), {pid: 123456, exitCode: null, signalCode: null});
    const group = {alive: true};
    const kill = sandbox.stub(process, "kill").callsFake((_pid, signal) => {
      if (signal === 0 && !group.alive) {
        throw Object.assign(new Error("No such process"), {code: "ESRCH"});
      } else if (signal === "SIGTERM") {
        group.alive = false;
      }
      return true;
    });
    const choose = sandbox.stub();
    const running = runLocalDevEnvironments({environmentName: "hillside", mode: "dev", port: 5001, logDir: null, logTimestamp: false, logViewer: true, s3BucketOverride: false}, async (_selected, frontend) => {
      frontend.child = angular as any;
      await openLogViewer({...config, signal: cancellation.signal});
      return false;
    }, choose);
    cancellation.abort(new Error("Backend stopped"));
    await running;
    expect(kill.args.some(args => args[0] === -123456 && args[1] === "SIGTERM")).toBe(true);
    expect(choose.called).toBe(false);
  });
});
