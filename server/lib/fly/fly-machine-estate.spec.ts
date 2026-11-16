import expect from "expect";
import { describe, it } from "mocha";
import sinon from "sinon";
import * as flyCommands from "./fly-commands";
import { FlyDeployStrategy, FlyMachineListItem } from "./fly.model";
import {
  deployFlyApp,
  machinesToRetire,
  assertReplacementsReady,
  readyReplacementMachines,
  parseFlyMachineList,
  parseFlyReleaseList
} from "./fly-machine-estate";

function machine(id: string, processGroup: string, tag: string, state = "started"): FlyMachineListItem {
  return {
    id,
    state,
    config: {metadata: processGroup ? {fly_process_group: processGroup} : {}},
    image_ref: {repository: "example.registry/ngx-ramblers", tag}
  };
}

describe("parseFlyMachineList", () => {
  it("reads a Fly JSON array of machines", () => {
    const parsed = parseFlyMachineList(JSON.stringify([machine("keep", "app", "1088")]));
    expect(parsed.map(item => item.id)).toEqual(["keep"]);
  });

  it("treats a non-array payload as no machines", () => {
    expect(parseFlyMachineList("{\"id\":\"x\"}")).toEqual([]);
  });
});

describe("machinesToRetire", () => {
  it("keeps the Launch app machine that is already on the requested image", () => {
    expect(machinesToRetire([machine("keep", "app", "1088")], {imageTag: "1088", scaleCount: 1})).toEqual([]);
  });

  it("retires a machine with no process group even if it is still started", () => {
    expect(machinesToRetire([machine("stray", "", "1081")], {imageTag: "1088", scaleCount: 1}).map(item => item.id)).toEqual(["stray"]);
  });

  it("retires a Launch machine that is still on an older image", () => {
    expect(machinesToRetire([machine("stale", "app", "1081")], {imageTag: "1088", scaleCount: 1}).map(item => item.id)).toEqual(["stale"]);
  });

  it("retires extra machines once the scale count is already met on the current image", () => {
    const keep = machine("aaaa", "app", "1088");
    const extra = machine("bbbb", "app", "1088");
    expect(machinesToRetire([keep, extra], {imageTag: "1088", scaleCount: 1}).map(item => item.id)).toEqual(["bbbb"]);
  });

  it("retires a stopped extra before a started keeper on the current image", () => {
    const started = machine("keep", "app", "1088", "started");
    const stopped = machine("old", "app", "1088", "stopped");
    expect(machinesToRetire([stopped, started], {imageTag: "1088", scaleCount: 1}).map(item => item.id)).toEqual(["old"]);
  });

  it("keeps a suspended replacement ahead of a machine that is still being created", () => {
    const creating = machine("a", "app", "1088", "created");
    const suspended = machine("b", "app", "1088", "suspended");
    const options = {imageTag: "1088", scaleCount: 1};
    expect(() => assertReplacementsReady("example-app", [creating, suspended], options)).not.toThrow();
    expect(machinesToRetire([creating, suspended], options)).toEqual([creating]);
  });

  it("leaves an empty list unchanged", () => {
    expect(machinesToRetire([], {imageTag: "1088", scaleCount: 1})).toEqual([]);
  });
});

describe("parseFlyReleaseList", () => {
  it("reads the latest Fly release from a JSON array", () => {
    const parsed = parseFlyReleaseList(JSON.stringify([{Version: 56, Status: "failed"}, {Version: 55, Status: "complete"}]));
    expect(parsed[0]).toEqual({Version: 56, Status: "failed"});
  });

  it("treats a non-array payload as no releases", () => {
    expect(parseFlyReleaseList("{\"Version\":56}")).toEqual([]);
  });
});

describe("readyReplacementMachines", () => {
  it("counts Launch app machines on the requested image that are started or stopped by Fly when idle", () => {
    const started = machine("started", "app", "1088");
    const stopped = machine("stopped", "app", "1088", "stopped");
    const suspended = machine("suspended", "app", "1088", "suspended");
    const failed = machine("failed", "app", "1088", "failed");
    const created = machine("created", "app", "1088", "created");
    const old = machine("old", "app", "1081");
    const stray = machine("stray", "", "1088");
    expect(readyReplacementMachines([started, stopped, suspended, failed, created, old, stray], {imageTag: "1088"}).map(item => item.id))
      .toEqual(["started", "stopped", "suspended"]);
  });
});

describe("assertReplacementsReady", () => {
  it("refuses to retire anything when the new image has fewer ready machines than the scale count", () => {
    const serving = machine("serving", "app", "1081");
    const failed = machine("failed", "app", "1088", "failed");
    expect(() => assertReplacementsReady("example-app", [serving, failed], {imageTag: "1088", scaleCount: 1}))
      .toThrow("Fly app example-app has 0 ready machines on 1088, needs 1 (serving:1081:started, failed:1088:failed)");
  });

  it("allows retirement once enough ready replacements exist", () => {
    const serving = machine("serving", "app", "1081");
    const replacement = machine("replacement", "app", "1088");
    expect(() => assertReplacementsReady("example-app", [serving, replacement], {imageTag: "1088", scaleCount: 1})).not.toThrow();
  });

  it("allows an app that scales to zero when its new machine has already been suspended", () => {
    const suspended = machine("worker", "app", "1088", "suspended");
    expect(() => assertReplacementsReady("example-worker", [suspended], {imageTag: "1088", scaleCount: 1})).not.toThrow();
  });
});

describe("deployment machine reconciliation", () => {
  [
    {label: "scales the app group when a stray hides a shortfall", group: ""},
    {label: "clones the ready replacement when a stale app machine hides a shortfall", group: "app"}
  ].forEach(({label, group}) => {
    it(label, async () => {
      const sandbox = sinon.createSandbox();
      const appName = "example-app";
      const existing = machine("existing", "app", "1088");
      const replacement = machine("replacement", "app", "1088");
      const stale = machine("stale", group, "1081");
      try {
        const command = sandbox.stub(flyCommands, "runCommand");
        const list = command.withArgs(`flyctl machines list --json --app ${appName}`, true);
        list.onFirstCall().returns(JSON.stringify([existing, stale]));
        list.onSecondCall().returns(JSON.stringify([existing, replacement, stale]));
        list.onThirdCall().returns(JSON.stringify([existing, replacement, stale]));
        list.onCall(3).returns(JSON.stringify([existing, replacement]));
        command.withArgs(`flyctl releases --json --app ${appName}`, true).returns(JSON.stringify([{Version: 1, Status: "complete", ImageRef: "example.registry/ngx-ramblers:1088"}]));
        const scale = sandbox.stub(flyCommands, "runCommandWithRetry").resolves();
        const clone = `flyctl machine clone existing --app ${appName}`;
        const scaleCount = `flyctl scale count 2 --app ${appName} --process-group app --yes`;
        const destroy = `flyctl machine destroy stale --app ${appName} --force`;

        await deployFlyApp({appName, configPath: "fly.toml", image: "example.registry/ngx-ramblers:1088", scaleCount: 2, memory: "512mb"});

        expect(scale.firstCall.args[0]).toBe(
          `flyctl deploy --app ${appName} --config fly.toml --image example.registry/ngx-ramblers:1088 --vm-memory 512 --strategy rolling --ha=false --wait-timeout 600`
        );

        expect(scale.calledWith(scaleCount)).toBe(!group);
        expect(command.calledWith(clone)).toBe(!!group);
        expect(command.calledWith(destroy)).toBe(true);
      } finally {
        sandbox.restore();
      }
    });
  });

  it("uses the release image for a remote build and retires a running machine on the previous image", async () => {
    const sandbox = sinon.createSandbox();
    const appName = "example-app";
    const previous = machine("previous", "app", "deployment-old");
    const current = machine("current", "app", "deployment-new", "suspended");
    try {
      const command = sandbox.stub(flyCommands, "runCommand");
      command.withArgs(`flyctl releases --json --app ${appName}`, true)
        .returns(JSON.stringify([{Version: 2, Status: "complete", ImageRef: "registry.fly.io/example-app:deployment-new"}]));
      const list = command.withArgs(`flyctl machines list --json --app ${appName}`, true);
      list.returns(JSON.stringify([previous, current]));
      list.onThirdCall().returns(JSON.stringify([current]));
      const output = sandbox.spy();
      const stream = sandbox.stub(flyCommands, "runCommandStreaming").callsFake(async (issued, onOutput) => {
        onOutput("Deploying");
        return {exitCode: 0, output: issued};
      });
      sandbox.stub(flyCommands, "runCommandWithRetry").callsFake(async (issued, execute) => {
        await execute(issued);
      });

      await deployFlyApp({appName, configPath: "fly.toml", remoteOnly: true, strategy: FlyDeployStrategy.IMMEDIATE, scaleCount: 1}, output);

      expect(stream.firstCall.args[0]).toContain("--remote-only --strategy immediate --ha=false");
      expect(output.firstCall.args).toEqual(["Deploying"]);
      expect(command.calledWith(`flyctl machine destroy previous --app ${appName} --force`)).toBe(true);
    } finally {
      sandbox.restore();
    }
  });

  it("distinguishes successive releases that both use latest", async () => {
    const sandbox = sinon.createSandbox();
    const appName = "example-app";
    const previous = machine("previous", "app", "latest");
    previous.config.metadata.fly_release_version = "1";
    const current = machine("current", "app", "latest", "suspended");
    current.config.metadata.fly_release_version = "2";
    try {
      const command = sandbox.stub(flyCommands, "runCommand");
      command.withArgs(`flyctl releases --json --app ${appName}`, true)
        .returns(JSON.stringify([{Version: 2, Status: "complete", ImageRef: "example.registry:5000/example-app:latest"}]));
      const list = command.withArgs(`flyctl machines list --json --app ${appName}`, true);
      list.returns(JSON.stringify([previous, current]));
      list.onThirdCall().returns(JSON.stringify([current]));

      sandbox.stub(flyCommands, "runCommandWithRetry").resolves();
      await deployFlyApp({appName, configPath: "fly.toml", scaleCount: 1});

      expect(command.calledWith(`flyctl machine destroy previous --app ${appName} --force`)).toBe(true);
    } finally {
      sandbox.restore();
    }
  });

  it("leaves machines in place when the release changes during scaling", async () => {
    const sandbox = sinon.createSandbox();
    const appName = "example-app";
    try {
      const command = sandbox.stub(flyCommands, "runCommand");
      const releases = command.withArgs(`flyctl releases --json --app ${appName}`, true);
      releases.onFirstCall().returns(JSON.stringify([{Version: 1, Status: "complete", ImageRef: "example.registry/example-app:old"}]));
      releases.onSecondCall().returns(JSON.stringify([{Version: 2, Status: "complete", ImageRef: "example.registry/example-app:new"}]));
      command.withArgs(`flyctl machines list --json --app ${appName}`, true)
        .returns(JSON.stringify([machine("existing", "app", "old")]));

      sandbox.stub(flyCommands, "runCommandWithRetry").resolves();
      await expect(deployFlyApp({appName, configPath: "fly.toml", scaleCount: 1}))
        .rejects.toThrow("changed from release v1 to v2 during scaling");

      expect(command.args.every(([issued]) => !issued.includes("machine destroy"))).toBe(true);
    } finally {
      sandbox.restore();
    }
  });

  it("leaves all machines in place when the deploy exits successfully but Fly records a failed release", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const command = sandbox.stub(flyCommands, "runCommand")
        .returns(JSON.stringify([{Version: 2, Status: "failed", ImageRef: "registry.fly.io/example-app:deployment-new"}]));
      const scale = sandbox.stub(flyCommands, "runCommandWithRetry").resolves();

      await expect(deployFlyApp({appName: "example-app", configPath: "fly.toml", scaleCount: 1}))
        .rejects.toThrow("latest release v2 is failed");

      expect(command.args).toEqual([["flyctl releases --json --app example-app", true]]);
      expect(scale.calledOnce).toBe(true);
    } finally {
      sandbox.restore();
    }
  });

});
