import { Db } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { MigrationUpResult } from "../../../../../projects/ngx-ramblers/src/app/models/mongo-migration.model";
import { seedDefaultLogoBanner } from "../shared/seed-default-banner";
import { envConfig } from "../../../env-config/env-config";
import { bannerPictureStoreFor } from "../../../environment-setup/aws-setup";

const debugLog = createMigrationLogger("retry-default-logo-banner-when-empty");

export async function up(db: Db): Promise<MigrationUpResult | void> {
  debugLog("Seeding a default logo-and-text banner when the banners collection is empty and a logo is configured");
  const aws = envConfig.aws();
  const pictureStore = aws.bucket && aws.accessKeyId && aws.secretAccessKey ? bannerPictureStoreFor(aws) : null;
  const result = await seedDefaultLogoBanner(db, debugLog, pictureStore);
  debugLog(result.reason);
  const migrationResult: MigrationUpResult = result.seeded
    ? {}
    : {skipped: true, reason: result.reason};
  return migrationResult;
}

export async function down(_db: Db) {
  debugLog("No down migration - default banner is left in place if present");
}
