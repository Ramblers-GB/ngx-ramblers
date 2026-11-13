import { Db, MongoClient, ObjectId } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { CONFIG_COLLECTION, NOTIFICATION_CONFIG_COLLECTION } from "../shared/collection-names";
import { ConfigKey } from "../../../../../projects/ngx-ramblers/src/app/models/config.model";
import {
  EMAIL_COMPOSER_BODY_PLACEHOLDER,
  EmailTemplateName,
  MEETING_INVITE_NOTIFICATION_SUBJECT_TEXT
} from "../../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { mostCommonBannerId, pickCommitteeRole } from "../shared/notification-config-site-defaults";

const debugLog = createMigrationLogger("meeting-invite-notification");
const seedId = new ObjectId("000000000000202611131200");
const mappingPath = "value.meetingInviteNotificationConfigId";
const migrationMappingPath = "migrationMeetingInviteNotificationConfigId";

export async function up(db: Db, _client: MongoClient) {
  const notificationConfigs = db.collection(NOTIFICATION_CONFIG_COLLECTION);
  const configCollection = db.collection(CONFIG_COLLECTION);
  const committeeConfig = await configCollection.findOne({key: ConfigKey.COMMITTEE});
  const committeeRoles: {type?: string; description?: string; vacant?: boolean}[] = committeeConfig?.value?.roles || [];
  const secretaryRole = pickCommitteeRole(committeeRoles, "secretary");
  const others = await notificationConfigs.find({"subject.text": {$ne: MEETING_INVITE_NOTIFICATION_SUBJECT_TEXT}}).toArray();
  const bannerId = mostCommonBannerId(others);
  const reference = others[0];
  const existing = await notificationConfigs.findOne({"subject.text": MEETING_INVITE_NOTIFICATION_SUBJECT_TEXT});
  const seed = {
    subject: {
      prefixParameter: "systemMergeFields.APP_SHORTNAME",
      text: MEETING_INVITE_NOTIFICATION_SUBJECT_TEXT,
      suffixParameter: ""
    },
    preSendActions: [],
    postSendActions: [],
    defaultMemberSelection: reference?.defaultMemberSelection || "recently-added",
    senderRole: secretaryRole,
    replyToRole: secretaryRole,
    signOffRoles: secretaryRole ? [secretaryRole] : [],
    bccRoles: [],
    templateName: EmailTemplateName.RAMBLERS_CAMPAIGN,
    bannerId,
    body: EMAIL_COMPOSER_BODY_PLACEHOLDER,
    omitComposeStep: true,
    omitEventsStep: true
  };
  if (!existing) {
    await notificationConfigs.updateOne({_id: seedId}, {$setOnInsert: seed}, {upsert: true});
    debugLog("Created default video meeting invite notification config: %s", seedId);
  }
  const configId = (existing?._id || seedId).toString();
  await configCollection.updateOne(
    {key: ConfigKey.BREVO, [mappingPath]: {$in: [null, ""]}},
    {$set: {[mappingPath]: configId, [migrationMappingPath]: configId}}
  );
}

export async function down(db: Db, _client: MongoClient) {
  const configCollection = db.collection(CONFIG_COLLECTION);
  await configCollection.updateOne(
    {key: ConfigKey.BREVO, [migrationMappingPath]: {$exists: true}, $expr: {$eq: [`$${mappingPath}`, `$${migrationMappingPath}`]}},
    {$unset: {[mappingPath]: 1}}
  );
  await configCollection.updateOne({key: ConfigKey.BREVO}, {$unset: {[migrationMappingPath]: 1}});
  const mappedSeed = await configCollection.findOne({key: ConfigKey.BREVO, [mappingPath]: seedId.toString()});
  if (!mappedSeed) {
    await db.collection(NOTIFICATION_CONFIG_COLLECTION).deleteOne({_id: seedId});
  }
}
