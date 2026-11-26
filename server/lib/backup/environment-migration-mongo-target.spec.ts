import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as environmentsConfig from "../environments/environments-config";
import * as atlasClusters from "../environment-setup/atlas-clusters";
import * as mongoDatabaseUser from "../environment-setup/mongo-database-user";
import { AtlasClusterState, AtlasClusterTier, AtlasClusterView } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { provisionMigrationMongoTarget, provisionMigrationMongoTargetRequest, secretsAfterRotation, storedMongoUriConflict } from "./environment-migration-mongo-target";
import { Request, Response } from "express";

describe("migration MongoDB target provisioning", () => {
  const sandbox = sinon.createSandbox();
  const target = {name: "group-sites", host: "group-sites.abc123", stateName: AtlasClusterState.IDLE, instanceSize: AtlasClusterTier.M20, inProvisioningProject: true, canAddEnvironment: true, limitHeadline: "Room for another site"};

  beforeEach(() => {
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({environments: [{environment: "hillside", mongo: {cluster: "source.abc123", db: "hillside-database"}}]} as never);
    sandbox.stub(atlasClusters, "atlasClusterView").resolves({atlasReachable: true, clusters: [target]} as AtlasClusterView);
    sandbox.stub(mongoDatabaseUser, "platformAtlasAccess").resolves({projectId: "project-1", publicKey: "public-key", privateKey: "private-key"});
    sandbox.stub(mongoDatabaseUser, "ensureScopedMongoUser").resolves({username: "hillside-user", password: "fictional-password"});
  });

  afterEach(() => sandbox.restore());

  it("creates the site's move login in the destination project, for the existing environment's database", async () => {
    const created = await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    expect(created).toEqual({cluster: target.host, db: "hillside-database", username: "hillside-user", password: "fictional-password"});
    const args = (mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).firstCall.args;
    expect(args[0]).toEqual({projectId: "project-1", publicKey: "public-key", privateKey: "private-key"});
    expect(args[1]).toBe("hillside-database");
    expect(args[2]).toBe("ngx_hillside_move_a");
  });

  it("reuses the same login when a move is retried, so logins do not pile up", async () => {
    await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    const calls = (mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).getCalls();
    expect(calls.map(call => call.args[2])).toEqual(["ngx_hillside_move_a", "ngx_hillside_move_a"]);
  });

  it("never picks the login the site is running on, from its settings or its stored connection", async () => {
    (environmentsConfig.configuredEnvironments as sinon.SinonStub).resolves({environments: [{environment: "hillside", mongo: {cluster: "source.abc123", db: "hillside-database", username: "ngx_hillside_move_a"}}]});
    await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    (environmentsConfig.configuredEnvironments as sinon.SinonStub).resolves({environments: [{environment: "hillside", mongo: {cluster: "source.abc123", db: "hillside-database", username: "older"}, secrets: {MONGODB_URI: "mongodb+srv://ngx_hillside_move_a:pw@source.abc123.mongodb.net/hillside-database"}}]});
    await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    const calls = (mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).getCalls();
    expect(calls.map(call => call.args[2])).toEqual(["ngx_hillside_move_b", "ngx_hillside_move_b"]);
  });

  it("creates the user in the destination project", async () => {
    (atlasClusters.atlasClusterView as sinon.SinonStub).resolves({atlasReachable: true, clusters: [{...target, projectId: "destination-project"}]});
    await provisionMigrationMongoTarget({environment: "hillside", cluster: target.host});
    expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).firstCall.args[0].projectId).toBe("destination-project");
  });

  it("rejects the source cluster without touching Atlas", async () => {
    await expect(provisionMigrationMongoTarget({environment: "hillside", cluster: "source.abc123"})).rejects.toThrow("different from the source");
    expect((atlasClusters.atlasClusterView as sinon.SinonStub).called).toBe(false);
    expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).called).toBe(false);
  });

  it("rejects an unknown environment before creating any credentials", async () => {
    await expect(provisionMigrationMongoTarget({environment: "unknown", cluster: target.host})).rejects.toThrow("Select an environment");
    expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).called).toBe(false);
  });

  [
    {atlasReachable: false, clusters: [target]},
    {atlasReachable: true, clusters: [{...target, inProvisioningProject: false}]},
    {atlasReachable: true, clusters: [{...target, stateName: AtlasClusterState.CREATING}]},
    {atlasReachable: true, clusters: [{...target, canAddEnvironment: false}]}
  ].forEach(view => {
    it("rejects an unreachable, external, busy or full target without creating credentials", async () => {
      (atlasClusters.atlasClusterView as sinon.SinonStub).resolves(view);
      await expect(provisionMigrationMongoTarget({environment: "hillside", cluster: target.host})).rejects.toThrow();
      expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).called).toBe(false);
    });
  });

  it("prevents the credential response from being cached", async () => {
    const response = {setHeader: sandbox.stub(), status: sandbox.stub().returnsThis(), json: sandbox.stub()};
    await provisionMigrationMongoTargetRequest({body: {environment: "hillside", cluster: target.host}} as Request, response as unknown as Response);
    expect(response.setHeader.calledWith("Cache-Control", "no-store")).toBe(true);
    expect(response.status.calledWith(201)).toBe(true);
    expect(response.json.firstCall.args[0].db).toBe("hillside-database");
  });
});

describe("migration source matches the live database", () => {
  const mongo = {cluster: "hillside.abc123", db: "hillside-database", username: "hillside-user", password: "fictional-password"};

  it("allows a migration when no MONGODB_URI is stored", () => {
    expect(storedMongoUriConflict({environment: "hillside", mongo})).toBeNull();
  });

  it("allows a migration when the stored MONGODB_URI names the same cluster and database", () => {
    const secrets = {MONGODB_URI: "mongodb+srv://hillside-user:fictional-password@hillside.abc123.mongodb.net/hillside-database?retryWrites=true&w=majority"};
    expect(storedMongoUriConflict({environment: "hillside", mongo, secrets})).toBeNull();
  });

  it("refuses when deploys use a stored MONGODB_URI on a different cluster", () => {
    const secrets = {MONGODB_URI: "mongodb+srv://hillside-user:fictional-password@older.def456.mongodb.net/hillside-database?retryWrites=true&w=majority"};
    expect(storedMongoUriConflict({environment: "hillside", mongo, secrets})).toContain("hillside runs on older.def456/hillside-database");
  });

  it("points a stored MONGODB_URI at the new cluster on rotation so a later deploy does not move the site back", () => {
    const rotated = secretsAfterRotation({MONGODB_URI: "mongodb+srv://old", AUTH_SECRET: "fictional"}, {MONGODB_URI: "mongodb+srv://new"});
    expect(rotated).toEqual({MONGODB_URI: "mongodb+srv://new", AUTH_SECRET: "fictional"});
  });

  it("leaves secrets without a stored MONGODB_URI unchanged on rotation", () => {
    expect(secretsAfterRotation({AUTH_SECRET: "fictional"}, {MONGODB_URI: "mongodb+srv://new"})).toEqual({AUTH_SECRET: "fictional"});
  });

  it("points stored AWS secrets at the new bucket on rotation so a later deploy does not move the site back", () => {
    const stored = {AWS_BUCKET: "hillside-old", AWS_REGION: "eu-west-1", AWS_ACCESS_KEY_ID: "OLDKEY", AWS_SECRET_ACCESS_KEY: "old-secret", AUTH_SECRET: "fictional"};
    const rotated = secretsAfterRotation(stored, {AWS_BUCKET: "hillside-eu-west-2", AWS_REGION: "eu-west-2", AWS_ACCESS_KEY_ID: "NEWKEY", AWS_SECRET_ACCESS_KEY: "new-secret"});
    expect(rotated).toEqual({AWS_BUCKET: "hillside-eu-west-2", AWS_REGION: "eu-west-2", AWS_ACCESS_KEY_ID: "NEWKEY", AWS_SECRET_ACCESS_KEY: "new-secret", AUTH_SECRET: "fictional"});
  });
});

describe("migration source check reads a stored MONGODB_URI the way the running site does", () => {
  const mongo = {cluster: "hillside.abc123", db: "hillside-database", username: "hillside-user", password: "fictional-password"};

  it("still refuses when the stored MONGODB_URI is wrapped in double quotes and names another cluster", () => {
    const secrets = {MONGODB_URI: "\"mongodb+srv://hillside-user:fictional-password@older.def456.mongodb.net/hillside-database?retryWrites=true&w=majority\""};
    expect(storedMongoUriConflict({environment: "hillside", mongo, secrets})).toContain("hillside runs on older.def456/hillside-database");
  });

  it("allows a quoted stored MONGODB_URI that names the same cluster and database", () => {
    const secrets = {MONGODB_URI: "\"mongodb+srv://hillside-user:fictional-password@hillside.abc123.mongodb.net/hillside-database\""};
    expect(storedMongoUriConflict({environment: "hillside", mongo, secrets})).toBeNull();
  });

  it("refuses when a stored MONGODB_URI is present but cannot be read", () => {
    expect(storedMongoUriConflict({environment: "hillside", mongo, secrets: {MONGODB_URI: "not a connection string"}})).toContain("cannot be read");
  });
});
