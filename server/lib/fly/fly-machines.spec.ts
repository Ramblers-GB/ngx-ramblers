import expect from "expect";
import sinon from "sinon";
import {afterEach, describe, it} from "mocha";
import * as runtime from "./fly-runtime-config";
import {flyMachinesAsleep, setCurrentMachineSecrets} from "./fly-machines";

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
