import expect from "expect";
import { describe, it } from "mocha";
import { archiveConfigFromSetup, previousArchiveFrom, withRotatedBackupArchive, backupListAwsTargets } from "./backup-archive";
import { backupArchiveBucketName } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { AwsRegion } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";

describe("backup-archive", () => {

  it("names the London archive with the region suffix", () => {
    expect(backupArchiveBucketName(AwsRegion.EU_WEST_2)).toBe("ngx-ramblers-database-backups-eu-west-2");
  });

  it("maps a setup result onto AwsConfig", () => {
    expect(archiveConfigFromSetup({
      bucket: "ngx-ramblers-database-backups-eu-west-2",
      region: "eu-west-2",
      iamUserName: "ngx-ramblers-database-backups-user",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      policyArn: "arn"
    })).toEqual({
      bucket: "ngx-ramblers-database-backups-eu-west-2",
      region: "eu-west-2",
      accessKeyId: "AKIA",
      secretAccessKey: "secret"
    });
  });

  it("keeps the previous Ireland archive when rotating", () => {
    const current = {bucket: "ngx-ramblers-database-backups", region: "eu-west-1", accessKeyId: "OLD", secretAccessKey: "old"};
    const next = {bucket: "ngx-ramblers-database-backups-eu-west-2", region: "eu-west-2", accessKeyId: "NEW", secretAccessKey: "new"};
    expect(previousArchiveFrom(current, next.bucket)).toEqual(current);
    expect(withRotatedBackupArchive(current, next)).toEqual({...next, previous: current});
  });

  it("does not restash when the destination is already the London archive", () => {
    const current = {
      bucket: "ngx-ramblers-database-backups-eu-west-2",
      region: "eu-west-2",
      accessKeyId: "NEW",
      secretAccessKey: "new",
      previous: {bucket: "ngx-ramblers-database-backups", region: "eu-west-1", accessKeyId: "OLD", secretAccessKey: "old"}
    };
    expect(previousArchiveFrom(current, current.bucket)).toEqual(current.previous);
  });

  it("lists the current archive and the previous Ireland archive", () => {
    const targets = backupListAwsTargets({
      bucket: "new-archive",
      region: "eu-west-2",
      accessKeyId: "NEW",
      secretAccessKey: "new",
      previous: {bucket: "old-archive", region: "eu-west-1", accessKeyId: "OLD", secretAccessKey: "old"}
    });
    expect(targets.map(target => target.bucket)).toEqual(["new-archive", "old-archive"]);
  });
});
