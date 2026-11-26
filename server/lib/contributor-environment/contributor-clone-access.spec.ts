import expect from "expect";
import sinon from "sinon";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as mongoDatabaseUser from "../environment-setup/mongo-database-user";
import * as atlasClusters from "../environment-setup/atlas-clusters";
import * as awsSetup from "../environment-setup/aws-setup";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { contributorIamUserName, contributorMongoUserName, environmentForClone, provisionContributorCloneAccess } from "./contributor-clone-access";

const request = {username: "ngx_hillside_db_user", sourceDatabase: "ngx-ramblers-hillside", targetDatabase: "ngx-ramblers-hillside-dev"};

const hillside = {
  environment: "hillside",
  mongo: {cluster: "cluster0.example", db: "ngx-ramblers-hillside", username: "ngx_hillside_db_user", password: "fictional-password"},
  aws: {bucket: "ngx-ramblers-hillside", region: "eu-west-2"}
} as EnvironmentConfig;

describe("contributor clone access names", () => {
  it("names the clone user after the clone, never the live database", () => {
    expect(contributorMongoUserName("ngx-ramblers-hillside-dev")).toEqual("ngx_contrib_hillside_dev");
    expect(contributorMongoUserName(`ngx-ramblers-${"a".repeat(80)}`).length).toBeLessThanOrEqual(64);
  });

  it("gives each group one read-only storage user within the IAM length limit", () => {
    expect(contributorIamUserName("hillside")).toEqual("ngx-ramblers-hillside-contributor-read");
    expect(contributorIamUserName("a".repeat(80)).length).toBeLessThanOrEqual(64);
  });
});

describe("environmentForClone", () => {
  it("only matches the environment that owns both the database and the user", () => {
    const other = {...hillside, environment: "valley", mongo: {...hillside.mongo, db: "ngx-ramblers-valley"}} as EnvironmentConfig;
    expect(environmentForClone([other, hillside], request)?.environment).toEqual("hillside");
    expect(environmentForClone([other], request)).toBeNull();
    expect(environmentForClone([hillside], {...request, username: "ngx_valley_db_user"})).toBeNull();
  });
});

describe("provisionContributorCloneAccess", () => {
  const state: {sandbox: sinon.SinonSandbox | null} = {sandbox: null};
  const atlas = {projectId: "project-1", publicKey: "public-key", privateKey: "private-key"};

  beforeEach(() => {
    state.sandbox = sinon.createSandbox();
    state.sandbox.stub(atlasClusters, "atlasAccessForCluster").resolves(atlas);
    state.sandbox.stub(mongoDatabaseUser, "grantDatabaseAccessToUser").resolves();
    state.sandbox.stub(mongoDatabaseUser, "ensureScopedMongoUser").resolves({username: "ngx_contrib_hillside_dev", password: "clone-password"});
    state.sandbox.stub(awsSetup, "adminConfigFromEnvironment").returns({accessKeyId: "admin-key", secretAccessKey: "admin-secret", region: "eu-west-2"});
    state.sandbox.stub(awsSetup, "setupReadOnlyAwsForBucket").resolves({
      bucket: "ngx-ramblers-hillside",
      region: "eu-west-2",
      iamUserName: "ngx-ramblers-hillside-contributor-read",
      accessKeyId: "read-key",
      secretAccessKey: "read-secret",
      policyArn: "arn:aws:iam::123456789012:policy/read"
    });
  });

  afterEach(() => {
    state.sandbox.restore();
  });

  it("returns a clone-only database user and read-only storage keys", async () => {
    const access = await provisionContributorCloneAccess(hillside, request);
    expect(access).toEqual({
      mongo: {username: "ngx_contrib_hillside_dev", password: "clone-password"},
      aws: {region: "eu-west-2", bucket: "ngx-ramblers-hillside", accessKeyId: "read-key", secretAccessKey: "read-secret"}
    });
    expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).firstCall.args).toEqual([atlas, "ngx-ramblers-hillside-dev", "ngx_contrib_hillside_dev"]);
    expect((mongoDatabaseUser.grantDatabaseAccessToUser as sinon.SinonStub).firstCall.args).toEqual([atlas, "ngx_hillside_db_user", "ngx-ramblers-hillside-dev"]);
    expect((atlasClusters.atlasAccessForCluster as sinon.SinonStub).firstCall.args).toEqual(["cluster0.example"]);
    expect((awsSetup.setupReadOnlyAwsForBucket as sinon.SinonStub).firstCall.args.slice(1)).toEqual(["ngx-ramblers-hillside-contributor-read", "ngx-ramblers-hillside", "eu-west-2"]);
  });

  it("refuses before touching Atlas when the group has no bucket", async () => {
    await expect(provisionContributorCloneAccess({...hillside, aws: undefined} as EnvironmentConfig, request)).rejects.toThrow("hillside has no S3 bucket configured");
    expect((mongoDatabaseUser.ensureScopedMongoUser as sinon.SinonStub).called).toBe(false);
  });
});
