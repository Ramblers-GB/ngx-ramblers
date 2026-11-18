import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { ensureActionButton } from "../shared/page-content-actions";
import { HOSTING_MENU_ITEM } from "../shared/admin-menu-items";
import { AdminPlatformPath } from "../../../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";

const debugLog = createMigrationLogger("add-hosting-menu-item");
const TARGET_PATH = `${AdminPlatformPath.ENVIRONMENT_MANAGEMENT}#action-buttons`;

export async function up(db: Db, _client: MongoClient) {
  debugLog("Adding Hosting menu item to environment management action buttons");
  const added = await ensureActionButton(db, TARGET_PATH, HOSTING_MENU_ITEM, debugLog);
  if (added) {
    debugLog("Hosting menu item added successfully");
  } else {
    debugLog("Hosting menu item already exists or could not be added");
  }
}

export async function down(_db: Db, _client: MongoClient) {
  debugLog("No down migration - Hosting menu item is intentionally left in place");
}
