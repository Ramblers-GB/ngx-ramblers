import debug from "debug";
import { envConfig } from "../env-config/env-config";
import * as configController from "../mongo/controllers/config";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { AWS_DEFAULTS, AwsConfig, AwsRegion, EnvironmentsConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import {
  BACKUP_ARCHIVE_RESOURCE_NAME,
  backupArchiveBucketName,
  BackupArchiveProvisionResult
} from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { adminConfigFromEnvironment, AwsSetupResult, setupAwsForBucket } from "./aws-setup";
import { execute } from "../mongo/mongoose-client";

const debugLog = debug(envConfig.logNamespace("backup-archive"));
debugLog.enabled = true;

export function archiveConfigFromSetup(setup: AwsSetupResult): AwsConfig {
  return {
    bucket: setup.bucket,
    region: setup.region,
    accessKeyId: setup.accessKeyId,
    secretAccessKey: setup.secretAccessKey
  };
}

export function previousArchiveFrom(current: AwsConfig | undefined, nextBucket: string): AwsConfig | undefined {
  if (current?.bucket && current.bucket !== nextBucket) {
    return {
      bucket: current.bucket,
      region: current.region,
      accessKeyId: current.accessKeyId,
      secretAccessKey: current.secretAccessKey
    };
  } else {
    return current?.previous;
  }
}

export function withRotatedBackupArchive(current: AwsConfig | undefined, next: AwsConfig): AwsConfig {
  const previous = previousArchiveFrom(current, next.bucket || "");
  if (previous) {
    return {...next, previous};
  } else {
    return next;
  }
}

export async function provisionBackupArchive(): Promise<BackupArchiveProvisionResult> {
  const admin = adminConfigFromEnvironment();
  if (!admin) {
    throw new Error("Add SETUP_AWS_ACCESS_KEY_ID and SETUP_AWS_SECRET_ACCESS_KEY for the Ramblers NGX account before creating the archive bucket.");
  } else {
    const region = AwsRegion.EU_WEST_2;
    const bucket = backupArchiveBucketName(region);
    const document = await execute(() => configController.queryKey(ConfigKey.ENVIRONMENTS));
    const current: EnvironmentsConfig = document?.value || {environments: []};
    if (current.aws?.bucket === bucket && current.aws.accessKeyId && current.aws.secretAccessKey) {
      debugLog("Archive bucket already configured:", bucket);
      return {aws: current.aws, created: false, bucket, region};
    } else {
      const setup = await setupAwsForBucket(admin, BACKUP_ARCHIVE_RESOURCE_NAME, bucket, region, {
        replaceAccessKeys: false,
        publicRead: false
      });
      const aws = withRotatedBackupArchive(current.aws, archiveConfigFromSetup(setup));
      await execute(() => configController.createOrUpdateKey(ConfigKey.ENVIRONMENTS, {...current, aws}));
      debugLog("Configured nightly archive", bucket, "in", region);
      return {aws, created: true, bucket, region};
    }
  }
}

export function backupListAwsTargets(aws: AwsConfig | undefined): {bucket: string; region: string; accessKeyId: string; secretAccessKey: string}[] {
  const current = aws?.bucket && aws.accessKeyId && aws.secretAccessKey
    ? [{
      bucket: aws.bucket,
      region: aws.region || AWS_DEFAULTS.REGION,
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey
    }]
    : [];
  const previous = aws?.previous?.bucket && aws.previous.accessKeyId && aws.previous.secretAccessKey
    ? [{
      bucket: aws.previous.bucket,
      region: aws.previous.region || AWS_DEFAULTS.REGION,
      accessKeyId: aws.previous.accessKeyId,
      secretAccessKey: aws.previous.secretAccessKey
    }]
    : [];
  return [...current, ...previous];
}
