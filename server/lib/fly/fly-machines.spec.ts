import expect from "expect";
import sinon from "sinon";
import {afterEach, describe, it} from "mocha";
import * as runtime from "./fly-runtime-config";
import {environmentAsleep, flyMachinesAsleep, setCurrentMachineSecrets} from "./fly-machines";
import {EnvironmentConfig, FlyMachineMode} from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";

describe("Fly cutover secrets confirmation", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  [
    {body: {data: {setSecrets: {release: {version: 12}}}}, ok: true},
    {body: {data: {setSecrets: {release: null}}}, ok: true},
    {body: {data: {setSecrets: {}}}, ok: true},
    {body: {}, ok: false},
    {body: {data: {setSecrets: null}}, ok: false},
    {body: {errors: [{message: "Update refused"}]}, ok: false}
  ].forEach(example => {
    it(`accepts a confirmed secrets update for ${JSON.stringify(example.body)}`, async () => {
      sandbox.stub(runtime, "flyRuntimeConfig").resolves({apiToken: "fictional-token", appName: "fictional-app"} as never);
      const fetchStub = sandbox.stub(globalThis, "fetch" as any);
      fetchStub.onFirstCall().resolves(new Response(JSON.stringify(example.body), {status: 200}));
      fetchStub.onSecondCall().resolves(new Response(JSON.stringify({version: 9}), {status: 200}));
      expect((await setCurrentMachineSecrets({MONGODB_URI: "mongodb+srv://user:password@cluster.example.org.uk/database"})).ok).toBe(example.ok);
    });
  });
});

describe("flyMachinesAsleep", () => {
  it("is asleep when a machine is stopped or suspended and none is running", () => {
    expect(flyMachinesAsleep([{id: "a", state: "suspended"}])).toEqual(true);
    expect(flyMachinesAsleep([{id: "a", state: "stopped"}])).toEqual(true);
  });

  it("is awake when any machine is running", () => {
    expect(flyMachinesAsleep([{id: "a", state: "started"}, {id: "b", state: "stopped"}])).toEqual(false);
  });

  it("is not asleep when there are no machines, so the site is still checked", () => {
    expect(flyMachinesAsleep([])).toEqual(false);
  });

  it("is not asleep when the machine is in some other state, such as failed or replacing", () => {
    expect(flyMachinesAsleep([{id: "a", state: "failed"}])).toEqual(false);
    expect(flyMachinesAsleep([{id: "a", state: "replacing"}])).toEqual(false);
  });
});

describe("environmentAsleep", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());
  const sleepy = {environment: "sleepy", flyMachines: FlyMachineMode.SLEEP_WHEN_IDLE, flyio: {apiKey: "fictional-token"}} as EnvironmentConfig;

  it("reads the machine state of a site that sleeps when idle, without visiting the site", async () => {
    const fetchStub = sandbox.stub(globalThis, "fetch" as any).resolves(new Response(JSON.stringify([{id: "a", state: "suspended"}]), {status: 200}));
    expect(await environmentAsleep(sleepy, "ngx-ramblers-sleepy")).toEqual(true);
    expect(fetchStub.firstCall.args[0]).toEqual("https://api.machines.dev/v1/apps/ngx-ramblers-sleepy/machines");
  });

  it("is not asleep when a site that sleeps when idle is running", async () => {
    sandbox.stub(globalThis, "fetch" as any).resolves(new Response(JSON.stringify([{id: "a", state: "started"}]), {status: 200}));
    expect(await environmentAsleep(sleepy, "ngx-ramblers-sleepy")).toEqual(false);
  });

  it("never asks Fly about an always-on site or one without a Fly token", async () => {
    const fetchStub = sandbox.stub(globalThis, "fetch" as any);
    expect(await environmentAsleep({...sleepy, flyMachines: FlyMachineMode.ALWAYS_ON}, "a")).toEqual(false);
    expect(await environmentAsleep({...sleepy, flyio: {}} as EnvironmentConfig, "a")).toEqual(false);
    expect(fetchStub.called).toEqual(false);
  });

  it("checks the site as usual when Fly cannot be asked", async () => {
    sandbox.stub(globalThis, "fetch" as any).resolves(new Response("", {status: 500}));
    expect(await environmentAsleep(sleepy, "ngx-ramblers-sleepy")).toEqual(false);
  });
});
