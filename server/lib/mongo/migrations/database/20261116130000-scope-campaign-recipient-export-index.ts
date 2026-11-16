import { Db, MongoClient } from "mongodb";
import { CAMPAIGN_RECIPIENT_EXPORT_INDEX } from "../../../brevo/campaigns/campaign-recipient-export.model";
import createMigrationLogger from "../migrations-logger";
import { CAMPAIGN_RECIPIENT_EXPORT_COLLECTION } from "../shared/collection-names";

const debugLog = createMigrationLogger("scope-campaign-recipient-export-index");
const LEGACY_INDEX_NAME = "campaignId_1";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  const exports = db.collection(CAMPAIGN_RECIPIENT_EXPORT_COLLECTION);
  await exports.createIndex(CAMPAIGN_RECIPIENT_EXPORT_INDEX, {unique: true});
  if (await exports.indexExists(LEGACY_INDEX_NAME)) {
    await exports.dropIndex(LEGACY_INDEX_NAME);
    debugLog("Replaced the campaign-only index with one keyed by Brevo account and campaign");
  } else {
    debugLog("Saved recipient exports are already keyed by Brevo account and campaign");
  }
}

export async function down(_db: Db, _client: MongoClient): Promise<void> {
  debugLog("Keeping the account-scoped index because campaign IDs can now repeat across accounts");
}
