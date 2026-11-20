import { AwsRegion, EnvironmentSiteLink } from "./environment-config.model";

export enum AwsS3MigrationStatus {
  NOT_MIGRATED = "not-migrated",
  NO_BUCKET = "no-bucket",
  UNMAPPED = "unmapped",
  ARCHIVE = "archive",
  MIGRATED = "migrated"
}

export enum AwsS3BucketKind {
  SITE = "site",
  ARCHIVE = "archive",
  UNMAPPED = "unmapped"
}

export enum EnvironmentAwsTab {
  PROVISIONING = "provisioning",
  BUCKETS = "buckets",
  ENVIRONMENTS = "environments"
}

export enum AwsS3BucketSortField {
  NAME = "name",
  REGION = "region",
  KIND = "kind",
  ENVIRONMENTS = "environmentNames",
  STATUS = "statusRank"
}

export enum AwsS3EnvironmentSortField {
  ENVIRONMENT = "environment",
  BUCKET = "bucket",
  REGION = "region",
  EXPECTED = "expectedLondonBucket",
  STATUS = "statusRank"
}

export interface AwsS3BucketRow {
  name: string;
  region: string | null;
  inRamblersAccount: boolean;
  kind: AwsS3BucketKind;
  environmentNames: string;
  environments: string[];
  sites: EnvironmentSiteLink[];
  status: AwsS3MigrationStatus;
  statusRank: number;
  migrateEnvironment: string | null;
}

export interface AwsS3EnvironmentRow {
  environment: string;
  siteUrl: string;
  bucket: string;
  region: string | null;
  inRamblersAccount: boolean;
  expectedLondonBucket: string;
  status: AwsS3MigrationStatus;
  statusRank: number;
}

export interface AwsS3InventoryView {
  keysConfigured: boolean;
  accountId: string;
  region: string;
  archiveBucket: string;
  archiveRegion: string;
  previousArchiveBucket: string;
  awsError: string | null;
  migratedCount: number;
  remainingCount: number;
  buckets: AwsS3BucketRow[];
  environments: AwsS3EnvironmentRow[];
}

export const AWS_S3_STATUS_RANK: Record<AwsS3MigrationStatus, number> = {
  [AwsS3MigrationStatus.NOT_MIGRATED]: 0,
  [AwsS3MigrationStatus.NO_BUCKET]: 1,
  [AwsS3MigrationStatus.UNMAPPED]: 2,
  [AwsS3MigrationStatus.ARCHIVE]: 3,
  [AwsS3MigrationStatus.MIGRATED]: 4
};

export function awsS3StatusLabel(status: AwsS3MigrationStatus): string {
  if (status === AwsS3MigrationStatus.MIGRATED) {
    return "London";
  } else if (status === AwsS3MigrationStatus.NOT_MIGRATED) {
    return "Still on old account";
  } else if (status === AwsS3MigrationStatus.ARCHIVE) {
    return "Estate archive";
  } else if (status === AwsS3MigrationStatus.NO_BUCKET) {
    return "No bucket configured";
  } else {
    return "Not used by a site";
  }
}

export function awsS3StatusBadgeClass(status: AwsS3MigrationStatus): string {
  if (status === AwsS3MigrationStatus.MIGRATED) {
    return "badge-mintcake";
  } else if (status === AwsS3MigrationStatus.NOT_MIGRATED || status === AwsS3MigrationStatus.NO_BUCKET) {
    return "badge-granite";
  } else {
    return "badge-cloudy";
  }
}

export function londonBucketInRamblersAccount(inRamblersAccount: boolean, region: string | null | undefined): boolean {
  return inRamblersAccount && region === AwsRegion.EU_WEST_2;
}
