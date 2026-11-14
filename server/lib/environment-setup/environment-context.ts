import debug from "debug";
import { Db, MongoClient } from "mongodb";
import { isString } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { EnvironmentConfig, EnvironmentsConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { configuredEnvironments } from "../environments/environments-config";
import { loadSecretsForEnvironmentFromDatabase } from "../shared/secrets";
import { buildMongoUri, parseMongoUri } from "../shared/mongodb-uri";
import { pullAllSecretsFromFly } from "../fly/fly-secrets";
import { connectToDatabase } from "./database-initialiser";
import {
  EnvironmentMongoSource,
  ResolvedEnvironmentMongo,
  SecretsFile
} from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";

const debugLog = debug(envConfig.logNamespace("environment-setup:context"));
debugLog.enabled = true;

export interface EnvironmentContext {
  environmentsConfig: EnvironmentsConfig;
  envConfigData: EnvironmentConfig;
  appName: string;
  secrets: SecretsFile;
}

export interface EnvironmentMongoConnection {
  client: MongoClient;
  db: Db;
  database: string;
}

export async function loadEnvironmentContext(environmentName: string): Promise<EnvironmentContext> {
  const environmentsConfig = await configuredEnvironments();
  const envConfigData = environmentsConfig.environments?.find(e => e.environment === environmentName);
  if (!envConfigData) {
    throw new EnvironmentNotFoundError(environmentName);
  }
  const appName = envConfigData.flyio?.appName || `ngx-ramblers-${environmentName}`;
  const secrets = await loadSecretsForEnvironmentFromDatabase(environmentName);
  if (!secrets) {
    throw new Error(`No secrets found in database for environment ${environmentName}`);
  }
  return { environmentsConfig, envConfigData, appName, secrets };
}

export function resolveEnvironmentMongoTarget(
  envConfigData: EnvironmentConfig,
  liveSecrets: Record<string, string>
): ResolvedEnvironmentMongo {
  const liveUri = liveSecrets?.[Environment.MONGODB_URI];
  if (isString(liveUri) && liveUri.trim()) {
    const parsed = parseMongoUri(liveUri);
    const database = parsed?.database;
    if (!database) {
      throw new Error(`No MongoDB database in live secrets for environment ${envConfigData.environment}`);
    } else {
      return {uri: liveUri.trim(), database, source: EnvironmentMongoSource.LIVE_SECRETS};
    }
  } else if (envConfigData.mongo?.cluster && envConfigData.mongo?.db) {
    const database = envConfigData.mongo.db;
    return {
      uri: buildMongoUri({
        cluster: envConfigData.mongo.cluster,
        username: envConfigData.mongo.username || "",
        password: envConfigData.mongo.password || "",
        database
      }),
      database,
      source: EnvironmentMongoSource.ENVIRONMENTS_CONFIG
    };
  } else {
    throw new Error(`No MongoDB configured for environment ${envConfigData.environment}`);
  }
}

async function connectWithTarget(envConfigData: EnvironmentConfig, liveSecrets: Record<string, string>): Promise<EnvironmentMongoConnection> {
  const target = resolveEnvironmentMongoTarget(envConfigData, liveSecrets);
  debugLog("connecting %s via %s db=%s", envConfigData.environment, target.source, target.database);
  const { client, db } = await connectToDatabase({ uri: target.uri, database: target.database });
  return { client, db, database: target.database };
}

export async function connectToEnvironmentMongo(envConfigData: EnvironmentConfig): Promise<EnvironmentMongoConnection> {
  return connectWithTarget(envConfigData, {});
}

export async function connectToLiveEnvironmentMongo(envConfigData: EnvironmentConfig): Promise<EnvironmentMongoConnection> {
  const appName = envConfigData.flyio?.appName || `ngx-ramblers-${envConfigData.environment}`;
  const flyToken = envConfigData.flyio?.apiKey || "";
  const liveSecrets = flyToken ? pullAllSecretsFromFly(appName, flyToken) : {};
  const liveUri = liveSecrets[Environment.MONGODB_URI];
  if (!isString(liveUri) || !liveUri.trim()) {
    throw new Error(`Could not verify the live MongoDB connection for ${envConfigData.environment}`);
  } else {
    return connectWithTarget(envConfigData, liveSecrets);
  }
}

export async function withBrevoApiKey<T>(brevoKey: string, fn: () => Promise<T>): Promise<T> {
  const originalKey = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = brevoKey;
  try {
    return await fn();
  } finally {
    if (originalKey !== undefined) {
      process.env.BREVO_API_KEY = originalKey;
    } else {
      delete process.env.BREVO_API_KEY;
    }
  }
}

export const DEFAULT_BASE_DOMAIN = "ngx-ramblers.org.uk";

export function baseDomainFrom(environmentsConfig: EnvironmentsConfig): string {
  return environmentsConfig.cloudflare?.baseDomain || DEFAULT_BASE_DOMAIN;
}

export class EnvironmentNotFoundError extends Error {
  constructor(environmentName: string) {
    super(`Environment ${environmentName} not found`);
    this.name = "EnvironmentNotFoundError";
  }
}
