import {
  BucketLocationConstraint,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateBucketCommandInput,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  AttachUserPolicyCommand,
  CreateAccessKeyCommand,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeletePolicyVersionCommand,
  GetPolicyCommand,
  GetUserCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListAttachedUserPoliciesCommand,
  ListPolicyVersionsCommand
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { existsSync, readFileSync } from "fs";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { resolveServerPath } from "../shared/path-utils";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { AssetToCopy, AwsAdminConfig, AwsCustomerCredentials, CopiedImage, CopyAssetsResult, ValidationResult } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { AWS_DEFAULTS } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { prefixedEnvironmentResourceName } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import { RootFolder } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { systemConfig } from "../config/system-config";
import { BannerPictureStore } from "./banner-picture.model";
import { findRamblersDirectoryLogo } from "../site-registration/registration-logos";

const debugLog = debug(envConfig.logNamespace("environment-setup:aws-setup"));
debugLog.enabled = true;

export interface AwsSetupResult {
  bucket: string;
  iamUserName: string;
  accessKeyId: string;
  secretAccessKey: string;
  policyArn: string;
}

export interface SetupAwsForBucketOptions {
  replaceAccessKeys?: boolean;
}

const PUBLIC_GET_OBJECT_PREFIXES: RootFolder[] = [
  RootFolder.backgrounds,
  RootFolder.bannerPhotos,
  RootFolder.carousels,
  RootFolder.committeeFiles,
  RootFolder.icons,
  RootFolder.logos,
  RootFolder.siteContent,
  RootFolder.walkImages,
  RootFolder.socialEventsImages,
  RootFolder.esriRoutes,
  RootFolder.socialPublishing
];

export function createS3Client(adminConfig: AwsAdminConfig): S3Client {
  return new S3Client({
    region: adminConfig.region,
    credentials: {
      accessKeyId: adminConfig.accessKeyId,
      secretAccessKey: adminConfig.secretAccessKey
    }
  });
}

function createIamClient(adminConfig: AwsAdminConfig): IAMClient {
  return new IAMClient({
    region: adminConfig.region,
    credentials: {
      accessKeyId: adminConfig.accessKeyId,
      secretAccessKey: adminConfig.secretAccessKey
    }
  });
}

export function generateBucketName(environmentName: string): string {
  return prefixedEnvironmentResourceName(environmentName, 63);
}

export function generateDestinationBucketName(environmentName: string, region: string = AWS_DEFAULTS.REGION): string {
  const suffix = `-${region}`;
  return `${prefixedEnvironmentResourceName(environmentName, 63 - suffix.length)}${suffix}`;
}

export function generateIamUserName(environmentName: string): string {
  return `${generateBucketName(environmentName)}-user`;
}

export function generatePolicyName(environmentName: string): string {
  return `${generateBucketName(environmentName)}-policy`;
}

function createBucketPolicy(bucketName: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        Resource: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`
        ]
      }
    ]
  });
}

export async function bucketExists(s3Client: S3Client, bucketName: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (error) {
    const status = error.$metadata?.httpStatusCode;
    if (error.name === "NotFound" || status === 404) {
      return false;
    } else if (status === 301 || status === 403 || error.name === "PermanentRedirect" || error.name === "AccessDenied") {
      throw new Error(`S3 bucket name ${bucketName} is already in use (another account or region). Choose a unique bucket name.`);
    } else {
      throw error;
    }
  }
}

async function userExists(iamClient: IAMClient, userName: string): Promise<boolean> {
  try {
    await iamClient.send(new GetUserCommand({ UserName: userName }));
    return true;
  } catch (error) {
    if (error.name === "NoSuchEntity" || error.name === "NoSuchEntityException") {
      return false;
    }
    throw error;
  }
}

export async function configureBucket(s3Client: S3Client, bucketName: string): Promise<void> {
  await s3Client.send(new PutPublicAccessBlockCommand({
    Bucket: bucketName,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: false,
      IgnorePublicAcls: false,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false
    }
  }));
  debugLog("Configured public access block for bucket:", bucketName);

  await s3Client.send(new PutBucketCorsCommand({
    Bucket: bucketName,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ["*"],
          AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
          AllowedOrigins: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000
        }
      ]
    }
  }));
  debugLog("Configured CORS for bucket:", bucketName);

  await s3Client.send(new PutBucketPolicyCommand({
    Bucket: bucketName,
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: PUBLIC_GET_OBJECT_PREFIXES.map(prefix => `arn:aws:s3:::${bucketName}/${prefix}/*`)
        }
      ]
    })
  }));
  debugLog("Configured public-read bucket policy for prefixes on:", bucketName);
}

export async function createS3Bucket(
  s3Client: S3Client,
  bucketName: string,
  region: string
): Promise<void> {
  debugLog("Creating S3 bucket:", bucketName, "in region:", region);

  const exists = await bucketExists(s3Client, bucketName);
  if (exists) {
    debugLog("Bucket already exists:", bucketName, "- ensuring configuration is correct");
    await configureBucket(s3Client, bucketName);
    return;
  }

  const createBucketParams: CreateBucketCommandInput = {
    Bucket: bucketName
  };

  if (region !== "us-east-1") {
    createBucketParams.CreateBucketConfiguration = {
      LocationConstraint: region as BucketLocationConstraint
    };
  }

  await s3Client.send(new CreateBucketCommand(createBucketParams));
  debugLog("Created bucket:", bucketName);

  await configureBucket(s3Client, bucketName);
}

async function getAwsAccountId(adminConfig: AwsAdminConfig): Promise<string> {
  const stsClient = new STSClient({
    region: adminConfig.region,
    credentials: {
      accessKeyId: adminConfig.accessKeyId,
      secretAccessKey: adminConfig.secretAccessKey
    }
  });
  const response = await stsClient.send(new GetCallerIdentityCommand({}));
  return response.Account || "";
}

async function policyExists(iamClient: IAMClient, policyArn: string): Promise<boolean> {
  try {
    await iamClient.send(new GetPolicyCommand({ PolicyArn: policyArn }));
    return true;
  } catch (error) {
    if (error.name === "NoSuchEntity" || error.name === "NoSuchEntityException") {
      return false;
    }
    throw error;
  }
}

async function isPolicyAttachedToUser(iamClient: IAMClient, userName: string, policyArn: string): Promise<boolean> {
  try {
    const response = await iamClient.send(new ListAttachedUserPoliciesCommand({ UserName: userName }));
    return (response.AttachedPolicies || []).some(p => p.PolicyArn === policyArn);
  } catch (error) {
    debugLog("Error checking attached policies:", error.message);
    return false;
  }
}

function generatePolicyArn(accountId: string, policyName: string): string {
  if (accountId) {
    return `arn:aws:iam::${accountId}:policy/${policyName}`;
  }
  return "";
}

async function listedAccessKeys(iamClient: IAMClient, userName: string) {
  const existingKeysResponse = await iamClient.send(new ListAccessKeysCommand({ UserName: userName }));
  return existingKeysResponse.AccessKeyMetadata || [];
}

async function deleteAccessKey(iamClient: IAMClient, userName: string, accessKeyId: string): Promise<void> {
  await iamClient.send(new DeleteAccessKeyCommand({
    UserName: userName,
    AccessKeyId: accessKeyId
  }));
  debugLog(`Deleted access key: ${accessKeyId}`);
}

async function prepareAccessKeySlot(iamClient: IAMClient, userName: string, replaceAccessKeys: boolean): Promise<void> {
  const existingKeys = await listedAccessKeys(iamClient, userName);
  debugLog(`User ${userName} has ${existingKeys.length} existing access keys`);
  if (replaceAccessKeys) {
    await Promise.all(existingKeys.filter(key => key.AccessKeyId).map(key => deleteAccessKey(iamClient, userName, key.AccessKeyId as string)));
  } else if (existingKeys.length >= 2) {
    const oldest = [...existingKeys].sort((left, right) => {
      const leftTime = left.CreateDate ? left.CreateDate.getTime() : 0;
      const rightTime = right.CreateDate ? right.CreateDate.getTime() : 0;
      return leftTime - rightTime;
    })[0];
    if (oldest?.AccessKeyId) {
      await deleteAccessKey(iamClient, userName, oldest.AccessKeyId);
    }
  }
}

async function createAccessKeyForUser(iamClient: IAMClient, userName: string): Promise<{ AccessKeyId: string; SecretAccessKey: string }> {
  const accessKeyResponse = await iamClient.send(new CreateAccessKeyCommand({ UserName: userName }));
  const accessKey = accessKeyResponse.AccessKey;
  if (!accessKey?.AccessKeyId || !accessKey?.SecretAccessKey) {
    throw new Error("Failed to create access key - no credentials returned");
  }
  debugLog("Created access key for user:", userName);
  return { AccessKeyId: accessKey.AccessKeyId, SecretAccessKey: accessKey.SecretAccessKey };
}

async function setManagedPolicyDocument(iamClient: IAMClient, policyArn: string, policyDocument: string): Promise<void> {
  const versions = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: policyArn }));
  const nonDefault = (versions.Versions || []).filter(version => !version.IsDefaultVersion);
  if (nonDefault.length >= 4) {
    const oldest = nonDefault[nonDefault.length - 1];
    if (oldest.VersionId) {
      await iamClient.send(new DeletePolicyVersionCommand({ PolicyArn: policyArn, VersionId: oldest.VersionId }));
    }
  }
  await iamClient.send(new CreatePolicyVersionCommand({
    PolicyArn: policyArn,
    PolicyDocument: policyDocument,
    SetAsDefault: true
  }));
}

export async function createIamUserWithBucketPolicy(
  iamClient: IAMClient,
  adminConfig: AwsAdminConfig,
  userName: string,
  bucketName: string,
  policyName: string,
  replaceAccessKeys = true
): Promise<{ accessKeyId: string; secretAccessKey: string; policyArn: string }> {
  debugLog("Setting up IAM user:", userName, "with policy for bucket:", bucketName);

  const accountId = await getAwsAccountId(adminConfig);
  debugLog("AWS Account ID:", accountId);

  const userAlreadyExists = await userExists(iamClient, userName);

  if (userAlreadyExists) {
    debugLog("IAM user already exists, reusing:", userName);
  } else {
    await iamClient.send(new CreateUserCommand({ UserName: userName }));
    debugLog("Created IAM user:", userName);
  }

  const policyDocument = createBucketPolicy(bucketName);
  let policyArn: string;

  const expectedPolicyArn = generatePolicyArn(accountId, policyName);
  const policyAlreadyExists = expectedPolicyArn && await policyExists(iamClient, expectedPolicyArn);

  if (policyAlreadyExists) {
    debugLog("Policy already exists, updating document:", expectedPolicyArn);
    policyArn = expectedPolicyArn;
    await setManagedPolicyDocument(iamClient, policyArn, policyDocument);
  } else {
    try {
      const createPolicyResponse = await iamClient.send(new CreatePolicyCommand({
        PolicyName: policyName,
        PolicyDocument: policyDocument,
        Description: `Policy for ngx-ramblers bucket ${bucketName}`
      }));
      policyArn = createPolicyResponse.Policy?.Arn;
      if (!policyArn) {
        throw new Error("Failed to create policy - no ARN returned");
      }
      debugLog("Created policy:", policyArn);
    } catch (error) {
      if (error.name === "EntityAlreadyExists") {
        debugLog("Policy already exists (caught during create), updating document");
        policyArn = expectedPolicyArn;
        if (!policyArn) {
          throw new Error(`Policy ${policyName} exists but couldn't determine ARN`);
        }
        await setManagedPolicyDocument(iamClient, policyArn, policyDocument);
      } else {
        throw error;
      }
    }
  }

  const isAttached = await isPolicyAttachedToUser(iamClient, userName, policyArn);
  if (!isAttached) {
    await iamClient.send(new AttachUserPolicyCommand({
      UserName: userName,
      PolicyArn: policyArn
    }));
    debugLog("Attached policy to user");
  } else {
    debugLog("Policy already attached to user");
  }

  await prepareAccessKeySlot(iamClient, userName, replaceAccessKeys);

  const accessKey = await createAccessKeyForUser(iamClient, userName);

  return {
    accessKeyId: accessKey.AccessKeyId,
    secretAccessKey: accessKey.SecretAccessKey,
    policyArn
  };
}

export async function setupAwsForCustomer(
  adminConfig: AwsAdminConfig,
  environmentName: string,
  region?: string
): Promise<AwsSetupResult> {
  const effectiveRegion = region || adminConfig.region;
  const bucketName = generateBucketName(environmentName);
  return setupAwsForBucket(adminConfig, environmentName, bucketName, effectiveRegion);
}

export async function setupAwsForBucket(
  adminConfig: AwsAdminConfig,
  environmentName: string,
  bucketName: string,
  region?: string,
  options?: SetupAwsForBucketOptions
): Promise<AwsSetupResult> {
  const effectiveRegion = region || adminConfig.region;
  const userName = generateIamUserName(environmentName);
  const policyName = generatePolicyName(environmentName);
  const replaceAccessKeys = options?.replaceAccessKeys !== false;

  debugLog("Setting up AWS for customer:", environmentName);
  debugLog("Bucket:", bucketName);
  debugLog("IAM User:", userName);
  debugLog("Region:", effectiveRegion);

  const s3Client = createS3Client(adminConfig);
  const iamClient = createIamClient(adminConfig);

  await createS3Bucket(s3Client, bucketName, effectiveRegion);

  const { accessKeyId, secretAccessKey, policyArn } = await createIamUserWithBucketPolicy(
    iamClient,
    adminConfig,
    userName,
    bucketName,
    policyName,
    replaceAccessKeys
  );

  return {
    bucket: bucketName,
    iamUserName: userName,
    accessKeyId,
    secretAccessKey,
    policyArn
  };
}

export async function validateAwsAdminCredentials(adminConfig: AwsAdminConfig): Promise<ValidationResult> {
  if (!adminConfig.accessKeyId || !adminConfig.secretAccessKey) {
    return { valid: false, message: "AWS admin credentials are required" };
  }

  try {
    const iamClient = createIamClient(adminConfig);
    await iamClient.send(new GetUserCommand({}));
    return { valid: true, message: "AWS admin credentials are valid" };
  } catch (error) {
    if (error.name === "InvalidClientTokenId" || error.name === "SignatureDoesNotMatch") {
      return { valid: false, message: "Invalid AWS credentials" };
    }
    return { valid: true, message: "AWS credentials appear valid" };
  }
}

function serverEnvValue(variableName: Environment): string | null {
  const envPath = resolveServerPath(".env");
  if (!existsSync(envPath)) {
    return null;
  } else {
    const match = readFileSync(envPath, "utf-8").split(/\r?\n/).find(line => line.startsWith(`${variableName}=`) && !line.trim().startsWith("#"));
    if (!match) {
      return null;
    } else {
      return match.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

export function adminConfigFromEnvironment(): AwsAdminConfig | null {
  const accessKeyId = process.env[Environment.SETUP_AWS_ACCESS_KEY_ID] || serverEnvValue(Environment.SETUP_AWS_ACCESS_KEY_ID) || process.env[Environment.AWS_ACCESS_KEY_ID];
  const secretAccessKey = process.env[Environment.SETUP_AWS_SECRET_ACCESS_KEY] || serverEnvValue(Environment.SETUP_AWS_SECRET_ACCESS_KEY) || process.env[Environment.AWS_SECRET_ACCESS_KEY];
  const region = process.env[Environment.SETUP_AWS_REGION] || serverEnvValue(Environment.SETUP_AWS_REGION) || process.env[Environment.AWS_REGION] || AWS_DEFAULTS.REGION;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return { accessKeyId, secretAccessKey, region };
}

export function generateAwsCredentialsResult(
  environmentName: string,
  region: string,
  setupResult: AwsSetupResult
): AwsCustomerCredentials {
  return {
    accessKeyId: setupResult.accessKeyId,
    secretAccessKey: setupResult.secretAccessKey,
    bucket: setupResult.bucket,
    region,
    iamUserName: setupResult.iamUserName,
    policyArn: setupResult.policyArn
  };
}

export const STANDARD_ASSETS = {
  sourceBucket: "ngx-ramblers-demo-staging"
};

async function listBucketKeys(s3Client: S3Client, bucket: string, continuationToken?: string): Promise<string[]> {
  const page = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    ContinuationToken: continuationToken
  }));
  const keys = (page.Contents || []).map(object => object.Key).filter((key): key is string => !!key);
  if (page.IsTruncated && page.NextContinuationToken) {
    return keys.concat(await listBucketKeys(s3Client, bucket, page.NextContinuationToken));
  } else {
    return keys;
  }
}

export async function copyAllS3Objects(
  adminConfig: AwsAdminConfig,
  sourceBucket: string,
  targetBucket: string
): Promise<{ copied: number }> {
  const s3Client = createS3Client(adminConfig);
  const keys = await listBucketKeys(s3Client, sourceBucket);
  debugLog("Copying %d objects from %s to %s", keys.length, sourceBucket, targetBucket);
  await keys.reduce<Promise<void>>(async (previous, key) => {
    await previous;
    await s3Client.send(new CopyObjectCommand({
      Bucket: targetBucket,
      Key: key,
      CopySource: `${sourceBucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`
    }));
  }, Promise.resolve());
  return { copied: keys.length };
}

export async function copyStandardAssets(
  adminConfig: AwsAdminConfig,
  targetBucket: string
): Promise<CopyAssetsResult> {
  const s3Client = createS3Client(adminConfig);
  const result: CopyAssetsResult = {
    icons: [],
    logos: [],
    backgrounds: [],
    failures: []
  };

  const config = await systemConfig();
  if (!config) {
    debugLog("No system config found - cannot determine which assets to copy");
    result.failures.push({file: "system-config", error: "No system config found"});
    return result;
  }

  debugLog("System config icons sample:", config.icons?.images?.[0]);
  debugLog("System config logos sample:", config.logos?.images?.[0]);
  debugLog("System config backgrounds sample:", config.backgrounds?.images?.[0]);

  const assetsToCopy: AssetToCopy[] = [];

  if (config.icons?.images) {
    for (const img of config.icons.images) {
      if (img.awsFileName) {
        assetsToCopy.push({
          sourceKey: img.awsFileName,
          folder: RootFolder.icons,
          image: {
            width: img.width || 150,
            originalFileName: img.originalFileName || img.awsFileName.split("/").pop(),
            awsFileName: img.awsFileName,
            padding: img.padding
          }
        });
      }
    }
  }

  if (config.logos?.images) {
    for (const img of config.logos.images) {
      if (img.awsFileName) {
        assetsToCopy.push({
          sourceKey: img.awsFileName,
          folder: RootFolder.logos,
          image: {
            width: img.width || 300,
            originalFileName: img.originalFileName || img.awsFileName.split("/").pop(),
            awsFileName: img.awsFileName,
            padding: img.padding
          }
        });
      }
    }
  }

  if (config.backgrounds?.images) {
    for (const img of config.backgrounds.images) {
      if (img.awsFileName) {
        assetsToCopy.push({
          sourceKey: img.awsFileName,
          folder: RootFolder.backgrounds,
          image: {
            width: img.width || 1920,
            originalFileName: img.originalFileName || img.awsFileName.split("/").pop(),
            awsFileName: img.awsFileName,
            padding: img.padding
          }
        });
      }
    }
  }

  debugLog(`Found ${assetsToCopy.length} assets to copy from system config`);

  for (const asset of assetsToCopy) {
    try {
      await s3Client.send(new CopyObjectCommand({
        Bucket: targetBucket,
        CopySource: `${STANDARD_ASSETS.sourceBucket}/${asset.sourceKey}`,
        Key: asset.sourceKey
      }));

      if (asset.folder === RootFolder.icons) result.icons.push(asset.image);
      else if (asset.folder === RootFolder.logos) result.logos.push(asset.image);
      else if (asset.folder === RootFolder.backgrounds) result.backgrounds.push(asset.image);

      debugLog(`Copied ${asset.sourceKey} to ${targetBucket}/${asset.sourceKey}`);
    } catch (copyError) {
      const errorMessage = copyError.message || String(copyError);
      debugLog(`Failed to copy ${asset.sourceKey}: ${errorMessage}`);
      result.failures.push({file: asset.sourceKey, error: errorMessage});
    }
  }

  return result;
}

export function bannerPictureStoreFor(adminConfig: AwsAdminConfig, bucket: string): BannerPictureStore {
  const s3Client = createS3Client(adminConfig);
  return {
    read: async (awsFileName: string) => {
      try {
        const object = await s3Client.send(new GetObjectCommand({Bucket: bucket, Key: awsFileName}));
        return object.Body ? await object.Body.transformToByteArray() : null;
      } catch (error) {
        debugLog("Could not read %s/%s for the banner picture: %s", bucket, awsFileName, error.message);
        return null;
      }
    },
    write: async (awsFileName: string, content: Buffer, contentType: string) => {
      await s3Client.send(new PutObjectCommand({Bucket: bucket, Key: awsFileName, Body: content, ContentType: contentType}));
    }
  };
}

export async function copyRamblersDirectoryLogo(adminConfig: AwsAdminConfig, targetBucket: string, groupName: string, areaName: string): Promise<CopiedImage | null> {
  const logo = await findRamblersDirectoryLogo(groupName, areaName);
  if (!logo) {
    return null;
  } else {
    const sourceBucket = envConfig.aws().bucket;
    if (sourceBucket !== targetBucket) {
      await createS3Client(adminConfig).send(new CopyObjectCommand({
        Bucket: targetBucket,
        CopySource: `${sourceBucket}/${logo.awsFileName}`,
        Key: logo.awsFileName
      }));
    }
    return {width: 300, padding: 0, originalFileName: logo.originalFileName, awsFileName: logo.awsFileName};
  }
}
