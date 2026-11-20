import debug from "debug";
import { GetBucketLocationCommand, ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { envConfig } from "../env-config/env-config";
import { configuredEnvironments } from "../environments/environments-config";
import {
  AWS_S3_STATUS_RANK,
  AwsS3BucketKind,
  AwsS3BucketRow,
  AwsS3EnvironmentRow,
  AwsS3InventoryView,
  AwsS3MigrationStatus,
  londonBucketInRamblersAccount
} from "../../../projects/ngx-ramblers/src/app/models/aws-s3-inventory.model";
import { AWS_DEFAULTS, AwsConfig, AwsRegion, awsRegionFromAny } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { backupArchiveBucketName, generateDestinationBucketName } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { configuredSiteLinks, configuredSiteUrl } from "../../../projects/ngx-ramblers/src/app/functions/environment-site-url";
import { adminConfigFromEnvironment, createS3Client, createStsClient, s3RegionFromLocationConstraint } from "./aws-setup";

const debugLog = debug(envConfig.logNamespace("aws-s3-inventory"));
debugLog.enabled = true;

function emptyView(partial: Partial<AwsS3InventoryView>): AwsS3InventoryView {
  return {
    keysConfigured: false,
    accountId: "",
    region: AWS_DEFAULTS.REGION,
    archiveBucket: "",
    archiveRegion: "",
    previousArchiveBucket: "",
    awsError: null,
    migratedCount: 0,
    remainingCount: 0,
    buckets: [],
    environments: [],
    ...partial
  };
}

function archiveNames(platformAws: AwsConfig | undefined): string[] {
  return [platformAws?.bucket, platformAws?.previous?.bucket, backupArchiveBucketName(AwsRegion.EU_WEST_2)].filter(Boolean) as string[];
}

export function environmentMigrationStatus(inRamblersAccount: boolean, region: string | null, isArchive: boolean, hasBucket: boolean): AwsS3MigrationStatus {
  if (!hasBucket) {
    return AwsS3MigrationStatus.NO_BUCKET;
  } else if (isArchive) {
    return AwsS3MigrationStatus.ARCHIVE;
  } else if (londonBucketInRamblersAccount(inRamblersAccount, region)) {
    return AwsS3MigrationStatus.MIGRATED;
  } else {
    return AwsS3MigrationStatus.NOT_MIGRATED;
  }
}

function bucketKind(name: string, environments: string[], archives: string[]): AwsS3BucketKind {
  if (archives.includes(name)) {
    return AwsS3BucketKind.ARCHIVE;
  } else if (environments.length) {
    return AwsS3BucketKind.SITE;
  } else {
    return AwsS3BucketKind.UNMAPPED;
  }
}

function bucketStatus(kind: AwsS3BucketKind, inRamblersAccount: boolean, region: string | null): AwsS3MigrationStatus {
  if (kind === AwsS3BucketKind.ARCHIVE) {
    return AwsS3MigrationStatus.ARCHIVE;
  } else if (kind === AwsS3BucketKind.UNMAPPED) {
    return AwsS3MigrationStatus.UNMAPPED;
  } else {
    return environmentMigrationStatus(inRamblersAccount, region, false, true);
  }
}

async function listedBucketRegions(s3: S3Client, names: string[]): Promise<Record<string, string | null>> {
  const rows = await Promise.all(names.map(async name => {
    try {
      const location = await s3.send(new GetBucketLocationCommand({Bucket: name}));
      return {name, region: s3RegionFromLocationConstraint(location.LocationConstraint)};
    } catch (error) {
      debugLog("GetBucketLocation failed for", name, error?.message || error);
      return {name, region: null as string | null};
    }
  }));
  return rows.reduce((acc, row) => {
    acc[row.name] = row.region;
    return acc;
  }, {} as Record<string, string | null>);
}

export async function awsS3InventoryView(): Promise<AwsS3InventoryView> {
  const admin = adminConfigFromEnvironment();
  const config = await configuredEnvironments();
  const platformAws = config?.aws;
  const archives = archiveNames(platformAws);
  const environments = (config?.environments || []).map(environment => ({
    environment: environment.environment,
    bucket: environment.aws?.bucket || "",
    configuredRegion: awsRegionFromAny(environment.aws?.region) || environment.aws?.region || null
  }));

  if (!admin) {
    return emptyView({
      archiveBucket: platformAws?.bucket || "",
      archiveRegion: platformAws?.region || "",
      previousArchiveBucket: platformAws?.previous?.bucket || "",
      awsError: "Add SETUP_AWS_ACCESS_KEY_ID and SETUP_AWS_SECRET_ACCESS_KEY for the Ramblers NGX account before this page can list buckets."
    });
  } else {
    const s3 = createS3Client(admin);
    const sts = createStsClient(admin);
    try {
      const [identity, listed] = await Promise.all([
        sts.send(new GetCallerIdentityCommand({})),
        s3.send(new ListBucketsCommand({}))
      ]);
      const listedNames = (listed.Buckets || []).map(bucket => bucket.Name).filter(Boolean) as string[];
      const listedSet = new Set(listedNames);
      const configuredNames = environments.map(environment => environment.bucket).filter(Boolean);
      const names = [...new Set([...listedNames, ...configuredNames, ...archives])];
      const regions = await listedBucketRegions(s3, listedNames);

      const environmentsByBucket = environments.reduce((acc, environment) => {
        if (environment.bucket) {
          acc[environment.bucket] = [...(acc[environment.bucket] || []), environment.environment];
        }
        return acc;
      }, {} as Record<string, string[]>);

      const buckets: AwsS3BucketRow[] = names.map(name => {
        const inRamblersAccount = listedSet.has(name);
        const region = regions[name] || environments.find(environment => environment.bucket === name)?.configuredRegion || null;
        const envNames = environmentsByBucket[name] || [];
        const kind = bucketKind(name, envNames, archives);
        const status = bucketStatus(kind, inRamblersAccount, region);
        const migrateEnvironment = status === AwsS3MigrationStatus.NOT_MIGRATED ? envNames[0] || null : null;
        return {
          name,
          region,
          inRamblersAccount,
          kind,
          environmentNames: envNames.join(", "),
          environments: envNames,
          sites: configuredSiteLinks(config, envNames),
          status,
          statusRank: AWS_S3_STATUS_RANK[status],
          migrateEnvironment
        };
      });

      const environmentRows: AwsS3EnvironmentRow[] = environments.map(environment => {
        const inRamblersAccount = environment.bucket ? listedSet.has(environment.bucket) : false;
        const region = (environment.bucket && regions[environment.bucket]) || environment.configuredRegion;
        const isArchive = environment.bucket ? archives.includes(environment.bucket) : false;
        const status = environmentMigrationStatus(inRamblersAccount, region, isArchive, !!environment.bucket);
        return {
          environment: environment.environment,
          siteUrl: configuredSiteUrl(config, environment.environment),
          bucket: environment.bucket,
          region,
          inRamblersAccount,
          expectedLondonBucket: generateDestinationBucketName(environment.environment, AwsRegion.EU_WEST_2),
          status,
          statusRank: AWS_S3_STATUS_RANK[status]
        };
      });

      const remainingCount = environmentRows.filter(row => row.status === AwsS3MigrationStatus.NOT_MIGRATED || row.status === AwsS3MigrationStatus.NO_BUCKET).length;
      const migratedCount = environmentRows.filter(row => row.status === AwsS3MigrationStatus.MIGRATED).length;

      return {
        keysConfigured: true,
        accountId: identity.Account || "",
        region: admin.region || AWS_DEFAULTS.REGION,
        archiveBucket: platformAws?.bucket || "",
        archiveRegion: platformAws?.region || "",
        previousArchiveBucket: platformAws?.previous?.bucket || "",
        awsError: null,
        migratedCount,
        remainingCount,
        buckets,
        environments: environmentRows
      };
    } catch (error) {
      debugLog("awsS3InventoryView failed:", error?.message || error);
      return emptyView({
        keysConfigured: true,
        region: admin.region || AWS_DEFAULTS.REGION,
        archiveBucket: platformAws?.bucket || "",
        archiveRegion: platformAws?.region || "",
        previousArchiveBucket: platformAws?.previous?.bucket || "",
        awsError: error?.message || "Could not list buckets in the Ramblers NGX account"
      });
    }
  }
}
