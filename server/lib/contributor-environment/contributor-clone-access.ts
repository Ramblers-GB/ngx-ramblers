import { configuredEnvironments } from "../environments/environments-config";
import { ensureScopedMongoUser, grantDatabaseAccessToUser, sanitisedEnvironmentName } from "../environment-setup/mongo-database-user";
import { atlasAccessForCluster } from "../environment-setup/atlas-clusters";
import { adminConfigFromEnvironment, setupReadOnlyAwsForBucket } from "../environment-setup/aws-setup";
import { AWS_DEFAULTS, EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { prefixedEnvironmentResourceName } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { ContributorCloneAccess, ContributorCloneAccessRequest } from "./contributor-environment.model";

export function contributorMongoUserName(targetDatabase: string): string {
  return `ngx_contrib_${sanitisedEnvironmentName(targetDatabase.replace(/^ngx-ramblers-/, ""))}`.slice(0, 64);
}

export function contributorIamUserName(environmentName: string): string {
  return `${prefixedEnvironmentResourceName(environmentName, 44)}-contributor-read`;
}

export function environmentForClone(environments: EnvironmentConfig[], request: ContributorCloneAccessRequest): EnvironmentConfig | null {
  return environments.find(item => item.mongo?.db === request.sourceDatabase && item.mongo?.username === request.username) || null;
}

export async function contributorCloneEnvironment(request: ContributorCloneAccessRequest): Promise<EnvironmentConfig | null> {
  const environments = await configuredEnvironments();
  return environmentForClone(environments.environments || [], request);
}

export async function provisionContributorCloneAccess(environment: EnvironmentConfig, request: ContributorCloneAccessRequest): Promise<ContributorCloneAccess> {
  const adminConfig = adminConfigFromEnvironment();
  if (!environment.aws?.bucket) {
    throw new Error(`${environment.environment} has no S3 bucket configured, so read-only storage keys cannot be created`);
  } else if (!adminConfig) {
    throw new Error("AWS admin credentials are not configured on the platform, so read-only storage keys cannot be created");
  } else {
    const atlas = await atlasAccessForCluster(environment.mongo?.cluster);
    await grantDatabaseAccessToUser(atlas, request.username, request.targetDatabase);
    const mongo = await ensureScopedMongoUser(atlas, request.targetDatabase, contributorMongoUserName(request.targetDatabase));
    const region = environment.aws.region || AWS_DEFAULTS.REGION;
    const storage = await setupReadOnlyAwsForBucket(adminConfig, contributorIamUserName(environment.environment), environment.aws.bucket, region);
    return {
      mongo,
      aws: {region, bucket: storage.bucket, accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey}
    };
  }
}
