import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { ensureActionButton, removeActionButtonByHref, replaceActionButtonByHref } from "../shared/page-content-actions";
import { CONTRIBUTOR_ENVIRONMENT_MENU_ITEM } from "../shared/admin-menu-items";
import { AdminPath, AdminPlatformPath, LegacyAdminPath } from "../../../../../projects/ngx-ramblers/src/app/models/admin-route-paths.model";

const debugLog = createMigrationLogger("move-contributor-environment-menu-item");
const ADMIN_PATH = `${AdminPath.ADMIN}#action-buttons`;
const PLATFORM_PATH = `${AdminPlatformPath.ROOT}#action-buttons`;

export async function up(db: Db, _client: MongoClient) {
  const replaced = await replaceActionButtonByHref(db, ADMIN_PATH, LegacyAdminPath.CONTRIBUTOR_ENVIRONMENT, CONTRIBUTOR_ENVIRONMENT_MENU_ITEM, debugLog);
  if (!replaced) {
    await ensureActionButton(db, ADMIN_PATH, CONTRIBUTOR_ENVIRONMENT_MENU_ITEM, debugLog);
  }
  await removeActionButtonByHref(db, PLATFORM_PATH, LegacyAdminPath.CONTRIBUTOR_ENVIRONMENT, debugLog);
  await removeActionButtonByHref(db, PLATFORM_PATH, AdminPath.CONTRIBUTOR_ENVIRONMENT, debugLog);
}

export async function down(_db: Db, _client: MongoClient) {
  debugLog("No down migration - Contributor Environment stays on the admin landing");
}
