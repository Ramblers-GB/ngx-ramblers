import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { MAIL_SETTINGS_SENDERS_HELP } from "../../../../../projects/ngx-ramblers/src/app/pages/admin/default-content";

const debugLog = createMigrationLogger("refresh-mail-settings-senders-help");
const CONTENT_TEXT_COLLECTIONS = ["contentText", "contentTexts"];

async function upsertInCollection(db: Db, collectionName: string): Promise<void> {
  const collection = db.collection(collectionName);
  const existing = await collection.findOne({
    name: MAIL_SETTINGS_SENDERS_HELP.name,
    category: MAIL_SETTINGS_SENDERS_HELP.category
  });
  if (existing) {
    await collection.updateOne({_id: existing._id}, {$set: {text: MAIL_SETTINGS_SENDERS_HELP.text}});
    debugLog(`Updated content text in ${collectionName}: ${MAIL_SETTINGS_SENDERS_HELP.name}`);
  } else {
    await collection.insertOne({...MAIL_SETTINGS_SENDERS_HELP});
    debugLog(`Added content text in ${collectionName}: ${MAIL_SETTINGS_SENDERS_HELP.name}`);
  }
}

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await CONTENT_TEXT_COLLECTIONS.reduce<Promise<void>>(
    (previous, collectionName) => previous.then(() => upsertInCollection(db, collectionName)),
    Promise.resolve()
  );
}

export async function down(_db: Db, _client: MongoClient): Promise<void> {
  debugLog(`No-op: refresh of ${MAIL_SETTINGS_SENDERS_HELP.name} is non-destructive`);
}
