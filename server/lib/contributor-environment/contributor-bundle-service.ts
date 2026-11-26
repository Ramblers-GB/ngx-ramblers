import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { ParsedMongoUri, buildMongoUri, parseMongoUri } from "../shared/mongodb-uri";
import { findEnvironmentFromDatabase } from "../environments/environments-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { contributorBundleFileName, contributorBundleZip } from "./contributor-bundle";
import { contributorBundleProblem } from "./contributor-bundle-validation";
import { contributorCloneAccess, copyIntoContributorClone, databaseHasCollections } from "./clone-database";
import { ContributorBundleAws, ContributorBundleOptions } from "./contributor-environment.model";

const debugLog = debug(envConfig.logNamespace("contributor-environment:bundle"));
debugLog.enabled = true;

export class ContributorBundleRequestError extends Error {}

function siteAws(): ContributorBundleAws {
  return {
    region: envConfig.value(Environment.AWS_REGION) || "",
    bucket: envConfig.value(Environment.AWS_BUCKET) || "",
    accessKeyId: envConfig.value(Environment.AWS_ACCESS_KEY_ID) || "",
    secretAccessKey: envConfig.value(Environment.AWS_SECRET_ACCESS_KEY) || ""
  };
}

async function bundleAppName(environmentName: string): Promise<string> {
  const environmentConfig = await findEnvironmentFromDatabase(environmentName).catch(() => null);
  return environmentConfig?.appName || `ngx-ramblers-${environmentName}`;
}

export function currentParsedMongo(): ParsedMongoUri | null {
  return parseMongoUri(envConfig.mongo().uri);
}

export async function generateContributorBundle(options: ContributorBundleOptions, keepMemberId: string | null, onProgress: (message: string) => void): Promise<{fileName: string; zip: Buffer}> {
  const parsedMongo = currentParsedMongo();
  const problem = contributorBundleProblem(options, parsedMongo);
  if (problem) {
    throw new ContributorBundleRequestError(problem);
  } else {
    const appName = await bundleAppName(options.environmentName);
    if (options.clone && await databaseHasCollections(options.schema)) {
      throw new ContributorBundleRequestError(`${options.schema} already has data. Choose a new schema name so the existing contributor's access is left alone.`);
    } else if (options.clone) {
      onProgress("Asking the platform for a clone-only database user and read-only storage keys");
      const access = await contributorCloneAccess(parsedMongo, options.schema, onProgress);
      onProgress(`Copying ${parsedMongo.database} into ${options.schema}`);
      await copyIntoContributorClone(parsedMongo, options.schema, keepMemberId, onProgress);
      debugLog("Generated clone contributor bundle for environment %s, schema %s", options.environmentName, options.schema);
      return {
        fileName: contributorBundleFileName(options.environmentName),
        zip: contributorBundleZip({
          environment: options.environmentName,
          appName,
          mongoUri: buildMongoUri({cluster: parsedMongo.cluster, username: access.mongo.username, password: access.mongo.password, database: options.schema}),
          aws: access.aws
        })
      };
    } else {
      debugLog("Generated live-database contributor bundle for environment %s", options.environmentName);
      return {
        fileName: contributorBundleFileName(options.environmentName),
        zip: contributorBundleZip({
          environment: options.environmentName,
          appName,
          mongoUri: buildMongoUri({cluster: parsedMongo.cluster, username: parsedMongo.username, password: parsedMongo.password, database: parsedMongo.database}),
          aws: siteAws()
        })
      };
    }
  }
}
