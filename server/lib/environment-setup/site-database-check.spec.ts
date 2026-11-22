import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { confirmRunningSiteDatabase, runningSiteDatabaseState, siteDatabaseStateFrom } from "./site-database-check";
import { databaseFingerprint, runningDatabaseFingerprint } from "../shared/database-fingerprint";
import { SiteDatabaseState, siteDatabaseWarning } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { EnvironmentConfig, FlyMachineMode } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";

const hillside = {environment: "hillside", mongo: {cluster: "shared-03.abc", db: "hillside-db"}} as EnvironmentConfig;

function details(fingerprint: string | null): Response {
  return new Response(JSON.stringify({buildNumber: "1", databaseFingerprint: fingerprint}), {status: 200});
}

describe("which database a running site is connected to", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it("reports a fingerprint of the cluster and database the process connects with, never the login", () => {
    const original = process.env.MONGODB_URI;
    process.env.MONGODB_URI = "mongodb+srv://someone:secret-password@shared-03.abc.mongodb.net/hillside-db?retryWrites=true";
    const fingerprint = runningDatabaseFingerprint();
    process.env.MONGODB_URI = original;
    expect(fingerprint).toEqual(databaseFingerprint("shared-03.abc", "hillside-db"));
    expect(fingerprint).toHaveLength(16);
    expect(fingerprint).not.toContain("shared-03");
    expect(databaseFingerprint("shared-03.abc.mongodb.net", "hillside-db")).toEqual(fingerprint);
  });

  it("compares the running site with its settings", () => {
    const expected = databaseFingerprint("shared-03.abc", "hillside-db");
    expect(siteDatabaseStateFrom(expected, "shared-03.abc", "hillside-db")).toEqual(SiteDatabaseState.MATCHES);
    expect(siteDatabaseStateFrom(databaseFingerprint("old.abc", "hillside-db"), "shared-03.abc", "hillside-db")).toEqual(SiteDatabaseState.DIFFERS);
    expect(siteDatabaseStateFrom(null, "shared-03.abc", "hillside-db")).toEqual(SiteDatabaseState.UNKNOWN);
  });

  it("only warns when the running site is on a different database", () => {
    expect(siteDatabaseWarning(SiteDatabaseState.DIFFERS, "shared-03.abc")).toContain("shared-03.abc");
    [SiteDatabaseState.MATCHES, SiteDatabaseState.ASLEEP, SiteDatabaseState.UNKNOWN, undefined].forEach(state => expect(siteDatabaseWarning(state, "shared-03.abc")).toBeNull());
  });

  it("asks the running site, not its settings", async () => {
    const fetchStub = sandbox.stub(globalThis, "fetch" as any).resolves(details(databaseFingerprint("old.abc", "hillside-db")));
    expect(await runningSiteDatabaseState(hillside, "shared-03.abc", "hillside-db")).toEqual(SiteDatabaseState.DIFFERS);
    expect(fetchStub.firstCall.args[0]).toEqual("https://ngx-ramblers-hillside.fly.dev/api/version/details");
  });

  it("does not wake a sleeping site to ask it", async () => {
    const sleepy = {...hillside, flyMachines: FlyMachineMode.SLEEP_WHEN_IDLE, flyio: {apiKey: "fictional-token"}} as EnvironmentConfig;
    const fetchStub = sandbox.stub(globalThis, "fetch" as any).resolves(new Response(JSON.stringify([{id: "a", state: "suspended"}]), {status: 200}));
    expect(await runningSiteDatabaseState(sleepy, "shared-03.abc", "hillside-db")).toEqual(SiteDatabaseState.ASLEEP);
    expect(fetchStub.calledOnce).toBe(true);
    expect(fetchStub.firstCall.args[0]).toContain("api.machines.dev");
  });

  it("waits for a restarted site to come up on the new database", async () => {
    const fetchStub = sandbox.stub(globalThis, "fetch" as any);
    fetchStub.onFirstCall().rejects(new Error("connection refused"));
    fetchStub.onSecondCall().resolves(details(databaseFingerprint("old.abc", "hillside-db")));
    fetchStub.onThirdCall().resolves(details(databaseFingerprint("shared-03.abc", "hillside-db")));
    expect(await confirmRunningSiteDatabase(hillside, "shared-03.abc", "hillside-db", 5, 1)).toEqual(SiteDatabaseState.MATCHES);
    expect(fetchStub.callCount).toBe(3);
  });

  it("gives up and reports the old database when the site never moves", async () => {
    sandbox.stub(globalThis, "fetch" as any).callsFake(async () => details(databaseFingerprint("old.abc", "hillside-db")));
    expect(await confirmRunningSiteDatabase(hillside, "shared-03.abc", "hillside-db", 3, 1)).toEqual(SiteDatabaseState.DIFFERS);
  });
});
