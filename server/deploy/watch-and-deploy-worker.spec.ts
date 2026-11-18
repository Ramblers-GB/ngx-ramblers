import expect from "expect";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import fs from "fs";
import readline from "readline";
import * as configuration from "../lib/environments/environments-config";
import * as flyToken from "./fly-org-token";
import { watchAndDeployWorker } from "./watch-and-deploy-worker";

const sandbox = sinon.createSandbox();

describe("development worker watcher cleanup", () => {
  afterEach(() => sandbox.restore());

  it("closes old environment watchers and cancels a queued deployment prompt", async () => {
    const clock = sandbox.useFakeTimers();
    sandbox.stub(configuration, "configuredEnvironments").resolves({environments: []} as any);
    sandbox.stub(flyToken, "applyFlyOrganisationToken");
    sandbox.stub(fs, "existsSync").returns(true);
    const close = sandbox.stub();
    const watch = sandbox.stub(fs, "watch").returns({close} as any);
    const prompt = sandbox.stub(readline, "createInterface");
    const stop = await watchAndDeployWorker("hillside-dev-worker");
    watch.firstCall.args[2]("change", "worker.ts");
    stop();
    clock.tick(3000);
    expect(watch.callCount).toBe(2);
    expect(close.callCount).toBe(2);
    expect(prompt.called).toBe(false);
  });
});
