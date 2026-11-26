import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import { envConfig } from "../env-config/env-config";
import * as environmentsConfig from "../environments/environments-config";
import * as cloneDatabase from "./clone-database";
import { ContributorBundleRequestError, generateContributorBundle } from "./contributor-bundle-service";

describe("generateContributorBundle", () => {
  const state: {sandbox: sinon.SinonSandbox | null} = {sandbox: null};
  const options = {environmentName: "hillside", schema: "ngx-ramblers-hillside-dev", clone: true};

  beforeEach(() => {
    state.sandbox = sinon.createSandbox();
    state.sandbox.stub(envConfig, "mongo").returns({uri: "mongodb+srv://ngx_hillside_db_user:fictional-password@cluster0.example.mongodb.net/ngx-ramblers-hillside"} as never);
    state.sandbox.stub(environmentsConfig, "findEnvironmentFromDatabase").resolves(null);
  });

  afterEach(() => {
    state.sandbox.restore();
  });

  it("refuses a clone schema that already has data before asking the platform for new credentials", async () => {
    state.sandbox.stub(cloneDatabase, "databaseHasCollections").resolves(true);
    const access = state.sandbox.stub(cloneDatabase, "contributorCloneAccess");
    const copy = state.sandbox.stub(cloneDatabase, "copyIntoContributorClone");
    const failure = await generateContributorBundle(options, "member-1", () => undefined).catch(error => error);
    expect(failure).toBeInstanceOf(ContributorBundleRequestError);
    expect(failure.message).toContain("ngx-ramblers-hillside-dev already has data");
    expect(access.called).toBe(false);
    expect(copy.called).toBe(false);
  });

  it("asks the platform for credentials and copies into an empty schema", async () => {
    state.sandbox.stub(cloneDatabase, "databaseHasCollections").resolves(false);
    const access = state.sandbox.stub(cloneDatabase, "contributorCloneAccess").resolves({
      mongo: {username: "ngx_contrib_hillside_dev", password: "clone-password"},
      aws: {region: "eu-west-2", bucket: "ngx-ramblers-hillside", accessKeyId: "read-key", secretAccessKey: "read-secret"}
    });
    const copy = state.sandbox.stub(cloneDatabase, "copyIntoContributorClone").resolves();
    const bundle = await generateContributorBundle(options, "member-1", () => undefined);
    expect(bundle.fileName).toEqual("contributor-environment-hillside.zip");
    expect(access.calledBefore(copy)).toBe(true);
  });
});
