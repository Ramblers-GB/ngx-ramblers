import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { PAGE_CONTENT_COLLECTION } from "../../../../../projects/ngx-ramblers/src/app/models/content-text.model";
import {
  LEGACY_ENVIRONMENT_MANAGEMENT_PAGE_PATH,
  LEGACY_PLATFORM_PAGE_PATH,
  combinedPlatformAdminColumns,
  PLATFORM_ADMIN_PAGE_PATH,
  platformAdminActionButtonsRow,
  platformAdminRows
} from "../shared/platform-admin-pages";

const debugLog = createMigrationLogger("combine-platform-admin-pages");

export async function up(db: Db, _client: MongoClient) {
  const collection = db.collection(PAGE_CONTENT_COLLECTION);
  const legacyPlatform = await collection.findOne({path: LEGACY_PLATFORM_PAGE_PATH});
  const legacyEnvironmentManagement = await collection.findOne({path: LEGACY_ENVIRONMENT_MANAGEMENT_PAGE_PATH});
  const platformAdmin = await collection.findOne({path: PLATFORM_ADMIN_PAGE_PATH});

  if (legacyPlatform || legacyEnvironmentManagement) {
    const columns = combinedPlatformAdminColumns({platformAdmin, legacyPlatform, legacyEnvironmentManagement});
    const row = platformAdminActionButtonsRow({platformAdmin, legacyEnvironmentManagement}, columns);
    if (platformAdmin) {
      await collection.updateOne({_id: platformAdmin._id}, {$set: {rows: [row]}});
    } else {
      await collection.insertOne({path: PLATFORM_ADMIN_PAGE_PATH, rows: [row]});
    }
    const removed = await collection.deleteMany({path: {$in: [LEGACY_PLATFORM_PAGE_PATH, LEGACY_ENVIRONMENT_MANAGEMENT_PAGE_PATH]}});
    debugLog(`Platform Admin page now has ${columns.length} buttons; removed ${removed.deletedCount} old platform pages`);
  } else {
    debugLog("No old platform pages found, so there was nothing to combine");
  }

  const documents = await collection.find({"rows.columns.href": {$regex: "admin/platform(/|$|[?#])"}}).toArray();
  const updates = documents
    .map(document => ({document, rows: platformAdminRows(document.rows)}))
    .filter(entry => JSON.stringify(entry.rows) !== JSON.stringify(entry.document.rows));
  await Promise.all(updates.map(entry => collection.updateOne({_id: entry.document._id}, {$set: {rows: entry.rows}})));
  debugLog(`Pointed links at Platform Admin on ${updates.length} pages`);
}

export async function down(_db: Db, _client: MongoClient) {
  debugLog("No down migration - the old platform pages are not restored");
}
