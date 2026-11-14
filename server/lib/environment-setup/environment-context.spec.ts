import expect from "expect";
import sinon from "sinon";
import { describe, it } from "mocha";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { EnvironmentMongoSource } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { connectToLiveEnvironmentMongo, resolveEnvironmentMongoTarget } from "./environment-context";

import * as fly from "../fly/fly-secrets";
import * as database from "./database-initialiser";

function environmentConfig(): EnvironmentConfig {
  return {
    environment: "group",
    mongo: {
      cluster: "group-registrations",
      db: "ngx-ramblers-group",
      username: "registrar",
      password: "registrar-secret"
    }
  } as EnvironmentConfig;
}

describe("resolveEnvironmentMongoTarget", () => {
  it("uses the live Fly MongoDB URI when present", () => {
    const liveUri = "mongodb+srv://site-user:site-secret@ngx-ramblers.example.net/ngx-ramblers-group?retryWrites=true&w=majority";
    const target = resolveEnvironmentMongoTarget(environmentConfig(), {[Environment.MONGODB_URI]: liveUri});
    expect(target.source).toEqual(EnvironmentMongoSource.LIVE_SECRETS);
    expect(target.database).toEqual("ngx-ramblers-group");
    expect(target.uri).toEqual(liveUri);
  });

  it("uses the environments document for the configured connection", () => {
    const target = resolveEnvironmentMongoTarget(environmentConfig(), {});
    expect(target.source).toEqual(EnvironmentMongoSource.ENVIRONMENTS_CONFIG);
    expect(target.database).toEqual("ngx-ramblers-group");
    expect(target.uri).toContain("group-registrations");
    expect(target.uri).not.toContain("ngx-ramblers.example.net");
  });

  it("does not require live secrets for the default connection", () => {
    const target = resolveEnvironmentMongoTarget(environmentConfig(), {[Environment.MONGODB_URI]: ""});
    expect(target.source).toEqual(EnvironmentMongoSource.ENVIRONMENTS_CONFIG);
  });
});

describe("connectToLiveEnvironmentMongo", () => {
  it("does not open the configured database when Fly cannot confirm the live URI", async () => {
    const sandbox = sinon.createSandbox();
    try {
      sandbox.stub(fly, "pullAllSecretsFromFly").returns({});
      const connect = sandbox.stub(database, "connectToDatabase");
      const config = {...environmentConfig(), flyio: {appName: "example-group", apiKey: "example-token"}} as EnvironmentConfig;

      await expect(connectToLiveEnvironmentMongo(config)).rejects.toThrow("Could not verify the live MongoDB connection");
      expect(connect.called).toBe(false);
    } finally {
      sandbox.restore();
    }
  });

  it("rejects a live URI without a database name", () => {
    const uri = "mongodb+srv://site-user:site-secret@example.net/";
    expect(() => resolveEnvironmentMongoTarget(environmentConfig(), {[Environment.MONGODB_URI]: uri}))
      .toThrow("No MongoDB database in live secrets");
  });
});
