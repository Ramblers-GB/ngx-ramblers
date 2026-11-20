import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { CONFIG_COLLECTION } from "../shared/collection-names";
import { ConfigKey } from "../../../../../projects/ngx-ramblers/src/app/models/config.model";
import { defaultAppDownloads } from "../../../../../projects/ngx-ramblers/src/app/models/system.model";

const debugLog = createMigrationLogger("ngx-app-downloads");
debugLog.enabled = true;

export async function up(db: Db, _client: MongoClient) {
  const result = await db.collection(CONFIG_COLLECTION).updateOne(
    {key: ConfigKey.SYSTEM},
    {$set: {"value.footer.appDownloads": {...defaultAppDownloads}}}
  );
  debugLog("Updated NGX app downloads on %d system configuration", result.modifiedCount);
}

export async function down(_db: Db, _client: MongoClient) {
  debugLog("NGX app download links retained; previous site-specific links cannot be restored automatically");
}
