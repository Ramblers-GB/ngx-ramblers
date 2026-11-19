import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { AwsRegion } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { AwsS3MigrationStatus } from "../../../projects/ngx-ramblers/src/app/models/aws-s3-inventory.model";
import { awsS3InventoryView, environmentMigrationStatus } from "./aws-s3-inventory";
import * as environmentsConfig from "../environments/environments-config";
import * as awsSetup from "./aws-setup";

describe("aws-s3-inventory", () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it("marks a London bucket in the Ramblers account as migrated", () => {
    expect(environmentMigrationStatus(true, AwsRegion.EU_WEST_2, false, true)).toEqual(AwsS3MigrationStatus.MIGRATED);
  });

  it("marks an Ireland or unlisted site bucket as still on the old account", () => {
    expect(environmentMigrationStatus(false, AwsRegion.EU_WEST_1, false, true)).toEqual(AwsS3MigrationStatus.NOT_MIGRATED);
    expect(environmentMigrationStatus(true, AwsRegion.EU_WEST_1, false, true)).toEqual(AwsS3MigrationStatus.NOT_MIGRATED);
  });

  it("joins listed London buckets to environments and leaves Ireland buckets as remaining", async () => {
    sandbox.stub(awsSetup, "adminConfigFromEnvironment").returns({
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      region: AwsRegion.EU_WEST_2
    });
    sandbox.stub(environmentsConfig, "configuredEnvironments").resolves({
      aws: {bucket: "ngx-ramblers-database-backups-eu-west-2", region: AwsRegion.EU_WEST_2, previous: {bucket: "ngx-ramblers-database-backups"}},
      environments: [
        {environment: "kent", aws: {bucket: "ngx-ramblers-kent-eu-west-2", region: AwsRegion.EU_WEST_2}},
        {environment: "ekwg", aws: {bucket: "ngx-ramblers-ekwg", region: AwsRegion.EU_WEST_1}}
      ]
    } as never);
    sandbox.stub(awsSetup, "createStsClient").returns({
      send: async () => ({Account: "123456789012"})
    } as never);
    sandbox.stub(awsSetup, "createS3Client").returns({
      send: async (command: {input?: {Bucket?: string}; constructor?: {name?: string}}) => {
        if (command.input?.Bucket === "ngx-ramblers-kent-eu-west-2" || command.input?.Bucket === "ngx-ramblers-database-backups-eu-west-2") {
          return {LocationConstraint: AwsRegion.EU_WEST_2};
        } else {
          return {
            Buckets: [
              {Name: "ngx-ramblers-kent-eu-west-2"},
              {Name: "ngx-ramblers-database-backups-eu-west-2"}
            ]
          };
        }
      }
    } as never);


    const view = await awsS3InventoryView();

    expect(view.keysConfigured).toEqual(true);
    expect(view.migratedCount).toEqual(1);
    expect(view.remainingCount).toEqual(1);
    expect(view.environments.find(row => row.environment === "kent")?.status).toEqual(AwsS3MigrationStatus.MIGRATED);
    expect(view.environments.find(row => row.environment === "ekwg")?.status).toEqual(AwsS3MigrationStatus.NOT_MIGRATED);
    expect(view.environments.find(row => row.environment === "ekwg")?.expectedLondonBucket).toEqual("ngx-ramblers-ekwg-eu-west-2");
  });
});
