import debug from "debug";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { envConfig } from "../env-config/env-config";
import { copyCollectionIndexes } from "../mongo/utils/collection-indexes";
import { ParsedMongoUri, buildMongoUri } from "../shared/mongodb-uri";
import { grantDatabaseAccessToUser, siteAtlasAccess } from "../environment-setup/mongo-database-user";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { booleanOf, pluraliseWithCount } from "../shared/string-utils";

const debugLog = debug(envConfig.logNamespace("contributor-environment:clone-database"));
debugLog.enabled = true;

const CLONE_ACCESS_ATTEMPTS = 15;
const CLONE_ACCESS_RETRY_MS = 2000;

export function cloneSchemaNameAllowed(sourceDatabase: string, targetDatabase: string): boolean {
  return !!sourceDatabase && !!targetDatabase && targetDatabase.startsWith(`${sourceDatabase}-`);
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

async function listCollectionsWorks(mongo: ParsedMongoUri, databaseName: string): Promise<boolean> {
  const client = new MongoClient(buildMongoUri({
    cluster: mongo.cluster,
    username: mongo.username,
    password: mongo.password,
    database: databaseName
  }), {serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000});
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

async function grantCloneAccessOnPlatform(username: string, sourceDatabase: string, targetDatabase: string): Promise<void> {
  const setupKey = envConfig.value(Environment.ENVIRONMENT_SETUP_API_KEY);
  if (!setupKey) {
    throw new Error("ENVIRONMENT_SETUP_API_KEY is not set, so this site cannot ask the platform to grant clone-schema access.");
  } else {
    const origin = "http://ngx-ramblers-staging.internal:8080";
    const response = await fetch(`${origin}/api/environment-setup/grant-clone-schema-access`, {
      method: "POST",
      headers: {"content-type": "application/json", "x-setup-api-key": setupKey},
      body: JSON.stringify({username, sourceDatabase, targetDatabase})
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({error: response.statusText})) as {error?: string};
      throw new Error(body.error || `The platform would not grant clone access (${response.status})`);
    }
  }
}

export async function ensureCloneSchemaAccess(mongo: ParsedMongoUri, targetDatabase: string): Promise<void> {
  if (await listCollectionsWorks(mongo, targetDatabase)) {
    debugLog("Current database user already has access to %s", targetDatabase);
  } else if (booleanOf(process.env[Environment.PLATFORM_ADMIN_ENABLED])) {
    const atlas = await siteAtlasAccess();
    await grantDatabaseAccessToUser(atlas, mongo.username, targetDatabase);
    await waitForCloneSchemaAccess(mongo, targetDatabase);
  } else {
    await grantCloneAccessOnPlatform(mongo.username, mongo.database, targetDatabase);
    await waitForCloneSchemaAccess(mongo, targetDatabase);
  }
}

export async function cloneDatabase(sourceDatabase: string, targetDatabase: string): Promise<void> {
  const client = mongoose.connection.getClient();
  const source = client.db(sourceDatabase);
  const target = client.db(targetDatabase);
  const collections = await source.listCollections().toArray();
  debugLog("Cloning %d collections from %s to %s", collections.length, sourceDatabase, targetDatabase);
  for (const collection of collections) {
    const documents = await source.collection(collection.name).find().toArray();
    if (documents.length > 0) {
      await copyCollectionIndexes(source.collection(collection.name), target.collection(collection.name));
      await target.collection(collection.name).insertMany(documents);
    }
    debugLog("Cloned %d documents into %s.%s", documents.length, targetDatabase, collection.name);
  }
}
