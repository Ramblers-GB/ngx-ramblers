import debug from "debug";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { envConfig } from "../env-config/env-config";
import { ParsedMongoUri, buildMongoUri } from "../shared/mongodb-uri";
import { waitForMongoLogin } from "../environment-setup/mongo-database-user";
import { cloneSourceDatabase } from "../environment-setup/full-duplicate";
import { connectToDatabase } from "../environment-setup/database-initialiser";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { booleanOf, pluraliseWithCount } from "../shared/string-utils";
import { ContributorCloneAccess, ContributorCloneAccessRequest } from "./contributor-environment.model";
import { contributorCloneEnvironment, provisionContributorCloneAccess } from "./contributor-clone-access";
import { CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS, sanitiseContributorClone } from "./contributor-clone-sanitise";

const debugLog = debug(envConfig.logNamespace("contributor-environment:clone-database"));
debugLog.enabled = true;

const CLONE_ACCESS_ATTEMPTS = 15;
const CLONE_ACCESS_RETRY_MS = 2000;
const PLATFORM_ORIGIN = "http://ngx-ramblers.internal:5001";

export function platformCloneAccessUrl(): string {
  return `${PLATFORM_ORIGIN}/api/environment-setup/contributor-clone-access`;
}

function isMongoUnauthorized(error: {code?: number; message?: string} | null | undefined): boolean {
  return error?.code === 13 || /not allowed to do action/i.test(error?.message || "");
}

export async function databaseHasCollections(databaseName: string): Promise<boolean> {
  const client = mongoose.connection.getClient();
  try {
    const collections = await client.db(databaseName).listCollections().toArray();
    return collections.length > 0;
  } catch (error) {
    if (isMongoUnauthorized(error)) {
      return false;
    } else {
      throw error;
    }
  }
}

function databaseUri(mongo: ParsedMongoUri, databaseName: string): string {
  return buildMongoUri({cluster: mongo.cluster, username: mongo.username, password: mongo.password, database: databaseName});
}

async function listCollectionsWorks(mongo: ParsedMongoUri, databaseName: string): Promise<boolean> {
  const client = new MongoClient(databaseUri(mongo, databaseName), {serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000});
  try {
    await client.connect();
    await client.db(databaseName).listCollections().toArray();
    return true;
  } catch (error) {
    if (isMongoUnauthorized(error)) {
      return false;
    } else {
      throw error;
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function waitForCloneSchemaAccess(mongo: ParsedMongoUri, databaseName: string, attempt = 1): Promise<void> {
  if (await listCollectionsWorks(mongo, databaseName)) {
    debugLog("Clone schema access ready for %s after %s", databaseName, pluraliseWithCount(attempt, "attempt"));
  } else if (attempt >= CLONE_ACCESS_ATTEMPTS) {
    throw new Error(`MongoDB Atlas had not granted access to ${databaseName} after ${Math.round(CLONE_ACCESS_ATTEMPTS * CLONE_ACCESS_RETRY_MS / 1000)} seconds. Retry generating the bundle in a minute.`);
  } else {
    await new Promise(resolve => setTimeout(resolve, CLONE_ACCESS_RETRY_MS));
    await waitForCloneSchemaAccess(mongo, databaseName, attempt + 1);
  }
}

async function requestCloneAccessFromPlatform(request: ContributorCloneAccessRequest): Promise<ContributorCloneAccess> {
  const setupKey = envConfig.value(Environment.ENVIRONMENT_SETUP_API_KEY);
  if (!setupKey) {
    throw new Error("ENVIRONMENT_SETUP_API_KEY is not set, so this site cannot ask the platform to set up clone access.");
  } else {
    const response = await fetch(platformCloneAccessUrl(), {
      method: "POST",
      headers: {"content-type": "application/json", "x-setup-api-key": setupKey},
      body: JSON.stringify(request)
    });
    const body = await response.json().catch(() => ({error: response.statusText})) as ContributorCloneAccess & {error?: string};
    if (!response.ok) {
      throw new Error(body.error || `The platform would not set up clone access (${response.status})`);
    } else if (!body.mongo?.username || !body.aws?.accessKeyId) {
      throw new Error("The platform did not return clone credentials. It may be running an older release; redeploy the platform app and retry.");
    } else {
      return body;
    }
  }
}

async function provisionOnThisPlatform(request: ContributorCloneAccessRequest): Promise<ContributorCloneAccess> {
  const environment = await contributorCloneEnvironment(request);
  if (!environment) {
    throw new Error("This clone is not for a known environment on this platform");
  } else {
    return provisionContributorCloneAccess(environment, request);
  }
}

export async function contributorCloneAccess(mongo: ParsedMongoUri, targetDatabase: string, onProgress: (message: string) => void): Promise<ContributorCloneAccess> {
  const request: ContributorCloneAccessRequest = {username: mongo.username, sourceDatabase: mongo.database, targetDatabase};
  const access = booleanOf(process.env[Environment.PLATFORM_ADMIN_ENABLED])
    ? await provisionOnThisPlatform(request)
    : await requestCloneAccessFromPlatform(request);
  onProgress("Waiting for MongoDB Atlas to activate access to the clone");
  await waitForCloneSchemaAccess(mongo, targetDatabase);
  await waitForMongoLogin(mongo.cluster, access.mongo, targetDatabase, attempt => {
    if (attempt > 0) {
      onProgress(`Waiting for the contributor database user to become active (${pluraliseWithCount(attempt, "check")})`);
    }
  });
  return access;
}

export async function copyIntoContributorClone(mongo: ParsedMongoUri, targetDatabase: string, keepMemberId: string | null, onProgress: (message: string) => void): Promise<void> {
  const target = {uri: databaseUri(mongo, targetDatabase), database: targetDatabase};
  const result = await cloneSourceDatabase(
    {uri: databaseUri(mongo, mongo.database), database: mongo.database},
    target,
    progress => onProgress(progress.message),
    CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS
  );
  onProgress(`Copied ${pluraliseWithCount(result.documents, "document")} in ${pluraliseWithCount(result.collections, "collection")}; removing live credentials and personal data`);
  const connection = await connectToDatabase(target);
  try {
    await sanitiseContributorClone(connection.db, keepMemberId);
  } finally {
    await connection.client.close();
  }
}
