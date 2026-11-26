import { keys } from "es-toolkit/compat";
import { Request, Response } from "express";
import { configuredEnvironments } from "../environments/environments-config";
import { atlasAccessInProject, atlasClusterView } from "../environment-setup/atlas-clusters";
import { ensureScopedMongoUser, migrationLoginFor, platformAtlasAccess } from "../environment-setup/mongo-database-user";
import { AtlasClusterState } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { EnvironmentMigrationMongoProvisionRequest, EnvironmentMigrationMongoTarget } from "../../../projects/ngx-ramblers/src/app/models/environment-migration.model";
import { createErrorDebugLog } from "../shared/error-debug-log";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { storedMongoUri } from "../shared/stored-mongo-uri";

const errorDebugLog = createErrorDebugLog("environment-migration-mongo-target");

export async function provisionMigrationMongoTarget(request: EnvironmentMigrationMongoProvisionRequest): Promise<EnvironmentMigrationMongoTarget> {
  const config = await configuredEnvironments();
  const source = config.environments?.find(environment => environment.environment === request.environment);
  if (!source?.mongo?.db || !source.mongo.cluster) {
    throw new Error("Select an environment with a configured MongoDB database.");
  } else if (!request.cluster || request.cluster === source.mongo.cluster) {
    throw new Error("Choose a target cluster different from the source cluster.");
  } else {
    const view = await atlasClusterView();
    const target = view.clusters.find(cluster => cluster.host === request.cluster && cluster.inProvisioningProject);
    if (!view.atlasReachable || !target) {
      throw new Error("Choose a target cluster in the configured Atlas project.");
    } else if (target.stateName !== AtlasClusterState.IDLE) {
      throw new Error("Wait until the target Atlas cluster is idle before creating a database user.");
    } else if (!target.canAddEnvironment) {
      throw new Error(target.limitHeadline);
    } else {
      const atlas = await platformAtlasAccess();
      const created = await ensureScopedMongoUser(atlasAccessInProject(atlas, target.projectId), source.mongo.db, migrationLoginFor(request.environment, [source.mongo.username, storedMongoUri(source).parsed?.username]));
      return {cluster: target.host, db: source.mongo.db, ...created};
    }
  }
}

export async function provisionMigrationMongoTargetRequest(req: Request, res: Response): Promise<void> {
  try {
    const target = await provisionMigrationMongoTarget({environment: req.body?.environment, cluster: req.body?.cluster});
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(target);
  } catch (error) {
    errorDebugLog("provisionMigrationMongoTarget:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not create the migration database user"});
  }
}

export function storedMongoUriConflict(environmentConfig: EnvironmentConfig | null | undefined): string | null {
  const {present, parsed: stored} = storedMongoUri(environmentConfig);
  const mongo = environmentConfig?.mongo;
  if (present && !stored) {
    return `${environmentConfig.environment} has a stored MONGODB_URI that cannot be read, so the database the site really uses is unknown. Correct or remove it before migrating.`;
  } else if (stored && mongo?.cluster && (stored.cluster !== mongo.cluster || stored.database !== mongo.db)) {
    return `${environmentConfig.environment} runs on ${stored.cluster}/${stored.database}, the stored MONGODB_URI that deploys use, but its MongoDB settings say ${mongo.cluster}/${mongo.db}. Correct the MongoDB settings to match the live database before migrating, otherwise the copy would come from the wrong database.`;
  } else {
    return null;
  }
}

export function secretsAfterRotation(secrets: Record<string, string> | undefined, rotated: Record<string, string>): Record<string, string> | undefined {
  const replaced = keys(rotated).filter(key => secrets?.[key]);
  return secrets && replaced.length ? replaced.reduce((result, key) => ({...result, [key]: rotated[key]}), secrets) : secrets;
}
