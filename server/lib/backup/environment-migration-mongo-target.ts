import { generateUid } from "../../../projects/ngx-ramblers/src/app/functions/numbers";
import { Request, Response } from "express";
import { configuredEnvironments } from "../environments/environments-config";
import { atlasClusterView } from "../environment-setup/atlas-clusters";
import { createEnvironmentMongoUser, platformAtlasAccess } from "../environment-setup/mongo-database-user";
import { AtlasClusterState } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { EnvironmentMigrationMongoProvisionRequest, EnvironmentMigrationMongoTarget } from "../../../projects/ngx-ramblers/src/app/models/environment-migration.model";
import { createErrorDebugLog } from "../shared/error-debug-log";
import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { parseMongoUri } from "../shared/mongodb-uri";

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
      const created = await createEnvironmentMongoUser({...atlas, projectId: target.projectId || atlas.projectId}, source.mongo.db, `${request.environment}_migration_${generateUid()}`, false);
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
  const stored = parseMongoUri(environmentConfig?.secrets?.[Environment.MONGODB_URI] || "");
  const mongo = environmentConfig?.mongo;
  const conflicting = !!stored && !!mongo?.cluster && (stored.cluster !== mongo.cluster || stored.database !== mongo.db);
  return conflicting
    ? `${environmentConfig.environment} runs on ${stored.cluster}/${stored.database}, the stored MONGODB_URI that deploys use, but its MongoDB settings say ${mongo.cluster}/${mongo.db}. Correct the MongoDB settings to match the live database before migrating, otherwise the copy would come from the wrong database.`
    : null;
}

export function secretsAfterMongoRotation(secrets: Record<string, string> | undefined, targetUri: string): Record<string, string> | undefined {
  return secrets?.[Environment.MONGODB_URI] ? {...secrets, [Environment.MONGODB_URI]: targetUri} : secrets;
}
