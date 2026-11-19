import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { ensureActionButton } from "../shared/page-content-actions";
import { AWS_MENU_ITEM } from "../shared/admin-menu-items";
import { AdminPlatformPath } from "../../../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";

const debugLog = createMigrationLogger("add-aws-s3-menu-item");
const TARGET_PATH = `${AdminPlatformPath.ENVIRONMENT_MANAGEMENT}#action-buttons`;

export async function up(db: Db, _client: MongoClient) {
  debugLog("Adding AWS S3 menu item to environment management action buttons");
  const added = await ensureActionButton(db, TARGET_PATH, AWS_MENU_ITEM, debugLog);
  if (added) {
    debugLog("AWS S3 menu item added successfully");
  } else {
    debugLog("AWS S3 menu item already exists or could not be added");
  }
}

export async function down(_db: Db, _client: MongoClient) {
  debugLog("No down migration - AWS S3 menu item is intentionally left in place");
}
