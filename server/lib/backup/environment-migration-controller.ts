import debug from "debug";
import { NextFunction, Request, Response } from "express";
import { isString } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { createEnvironmentMigrationService } from "./environment-migration-service";
import { asNumber } from "../../../projects/ngx-ramblers/src/app/functions/numbers";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { booleanOf } from "../shared/string-utils";
import { AWS_DEFAULTS } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { adminConfigFromEnvironment, generateDestinationBucketName } from "../environment-setup/aws-setup";

const debugLog = debug(envConfig.logNamespace("environment-migration-controller"));
debugLog.enabled = false;

export function requireEnvironmentMigrationEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!booleanOf(process.env[Environment.PLATFORM_ADMIN_ENABLED])) {
    res.status(403).json({error: "Environment migration is not enabled on this environment"});
  } else {
    next();
  }
}

function errorMessage(error: any): string {
  return error?.message || "Environment migration request failed";
}

export async function history(req: Request, res: Response) {
  try {
    const service = createEnvironmentMigrationService();
    const limit = asNumber(req.query.limit || 50);
    const environment = isString(req.query.environment) ? req.query.environment : null;
    const migrations = await service.history(environment, limit);
    res.status(200).json(migrations);
  } catch (error) {
    debugLog("history:error:", error);
    res.status(500).json({ error: errorMessage(error) });
  }
}

export async function migration(req: Request, res: Response) {
  try {
    const service = createEnvironmentMigrationService();
    const migrationRecord = await service.migration(req.params.migrationId);
    if (!migrationRecord) {
      res.status(404).json({ error: "Migration not found" });
      return;
    }
    res.status(200).json(migrationRecord);
  } catch (error) {
    debugLog("migration:error:", error);
    res.status(500).json({ error: errorMessage(error) });
  }
}

export async function planMongoOnlyMigration(req: Request, res: Response) {
  try {
    const service = createEnvironmentMigrationService();
    const user = (req as any).user?.username || "unknown";
    const migrationRecord = await service.planMongoOnlyMigration({
      ...req.body,
      user
    });
    res.status(200).json(migrationRecord);
  } catch (error) {
    debugLog("planMongoOnlyMigration:error:", error);
    res.status(400).json({ error: errorMessage(error) });
  }
}

export async function executeMongoOnlyMigration(req: Request, res: Response) {
  try {
    const service = createEnvironmentMigrationService();
    const user = (req as any).user?.username || "unknown";
    const migrationRecord = await service.startMongoOnlyMigration({
      ...req.body,
      dryRun: false,
      user
    });
    res.status(200).json(migrationRecord);
  } catch (error) {
    debugLog("executeMongoOnlyMigration:error:", error);
    res.status(400).json({ error: errorMessage(error) });
  }
}

export async function platformAwsTarget(req: Request, res: Response) {
  const environment = isString(req.query.environment) ? req.query.environment : "";
  if (!environment) {
    res.status(400).json({ error: "environment is required" });
  } else {
    const adminConfig = adminConfigFromEnvironment();
    if (!adminConfig) {
      res.status(400).json({ error: "AWS admin credentials are not configured (SETUP_AWS_ACCESS_KEY_ID and SETUP_AWS_SECRET_ACCESS_KEY)" });
    } else {
      res.status(200).json({
        bucket: generateDestinationBucketName(environment),
        region: AWS_DEFAULTS.REGION,
        accessKeyId: adminConfig.accessKeyId,
        secretAccessKey: adminConfig.secretAccessKey
      });
    }
  }
}

export async function rotateMongoCredentials(req: Request, res: Response) {
  try {
    const service = createEnvironmentMigrationService();
    const user = (req as any).user?.username || "unknown";
    const migrationRecord = await service.rotateCredentials({
      ...req.body,
      user
    });
    res.status(200).json(migrationRecord);
  } catch (error) {
    debugLog("rotateMongoCredentials:error:", error);
    res.status(400).json({ error: errorMessage(error) });
  }
}
