import { Db, Document, Filter, ObjectId } from "mongodb";
import { Model } from "mongoose";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { PlatformSendControl } from "../../../projects/ngx-ramblers/src/app/models/mail.model";
import { sanitiseDuplicatedDatabase } from "../environment-setup/full-duplicate";
import { dateTimeNowAsValue } from "../shared/dates";
import { booking } from "../mongo/models/booking";
import { brevoBounceDiagnostic } from "../mongo/models/brevo-bounce-diagnostic";
import { brevoContactSnapshot } from "../mongo/models/brevo-contact-snapshot";
import { campaignRecipientExport } from "../mongo/models/campaign-recipient-export";
import { contactInteraction } from "../mongo/models/contact-interaction";
import { deletedMember } from "../mongo/models/deleted-member";
import { emailComposition } from "../mongo/models/email-composition";
import { expenseClaim } from "../mongo/models/expense-claim";
import { externalRecipient } from "../mongo/models/external-recipient";
import { inboxDeletedIdentity } from "../mongo/models/inbox-deleted-identity";
import { inboxFolder } from "../mongo/models/inbox-folder";
import { inboxMessage } from "../mongo/models/inbox-message";
import { inboxPushSubscription } from "../mongo/models/inbox-push-subscription";
import { inboxThread } from "../mongo/models/inbox-thread";
import { mailClientCredential } from "../mongo/models/mail-client-credential";
import { mailClientSubmission } from "../mongo/models/mail-client-submission";
import { mailListAudit } from "../mongo/models/mail-list-audit";
import { mailSendRefusal } from "../mongo/models/mail-send-refusal";
import { mailchimpListAudit } from "../mongo/models/mailchimp-list-audit";
import { meetingNote } from "../mongo/models/meeting-note";
import { meetingTranscriptLine } from "../mongo/models/meeting-transcript";
import { member } from "../mongo/models/member";
import { memberAudit } from "../mongo/models/member-audit";
import { memberBulkLoadAudit } from "../mongo/models/member-bulk-load-audit";
import { memberEmailSend } from "../mongo/models/member-email-send";
import { memberSyncNotification } from "../mongo/models/member-sync-notification";
import { memberUpdateAudit } from "../mongo/models/member-update-audit";
import { osMapsPersonalAccount } from "../mongo/models/os-maps-personal-account";
import { refreshToken } from "../mongo/models/refresh-token";
import { volunteerAssignmentAudit } from "../mongo/models/volunteer-assignment-audit";
import { volunteerExportAudit } from "../mongo/models/volunteer-export-audit";
import { volunteerImportAudit } from "../mongo/models/volunteer-import-audit";

export const CONTRIBUTOR_LOCAL_SITE_URL = "http://localhost:4200";

const EXCLUDED_MODELS: Model<any>[] = [
  booking,
  brevoBounceDiagnostic,
  brevoContactSnapshot,
  campaignRecipientExport,
  contactInteraction,
  deletedMember,
  emailComposition,
  expenseClaim,
  externalRecipient,
  inboxDeletedIdentity,
  inboxFolder,
  inboxMessage,
  inboxPushSubscription,
  inboxThread,
  mailClientCredential,
  mailClientSubmission,
  mailListAudit,
  mailSendRefusal,
  mailchimpListAudit,
  meetingNote,
  meetingTranscriptLine,
  memberAudit,
  memberBulkLoadAudit,
  memberEmailSend,
  memberSyncNotification,
  memberUpdateAudit,
  osMapsPersonalAccount,
  refreshToken,
  volunteerAssignmentAudit,
  volunteerExportAudit,
  volunteerImportAudit
];

export const CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS: string[] = [...new Set(EXCLUDED_MODELS.map(model => model.collection.collectionName))].sort();

export const CONTRIBUTOR_CLONE_REMOVED_CONFIG_KEYS: ConfigKey[] = [ConfigKey.ENVIRONMENTS, ConfigKey.SITE_REGISTRATION];

export const MEMBER_PERSONAL_FIELDS: string[] = [
  "assembleId",
  "contactId",
  "emailBlock",
  "jointWith",
  "landlineTelephone",
  "mail.id",
  "mail.lastSyncedListIds",
  "mail.lastSyncedSignature",
  "mailchimpLists",
  "membershipNumber",
  "mobileNumber",
  "nameAlias",
  "password",
  "passwordResetId",
  "postcode",
  "salesforceId",
  "salesforceMemberRef",
  "title"
];

export function contributorSendControl(): PlatformSendControl {
  return {
    sendingSuspended: true,
    reason: "Contributor clone: sending is switched off",
    changedAt: dateTimeNowAsValue(),
    changedBy: "contributor-environment"
  };
}

export function memberAnonymisationFilter(keepMemberId: string | null): Filter<Document> {
  return keepMemberId && ObjectId.isValid(keepMemberId) ? {_id: {$ne: new ObjectId(keepMemberId)}} : {};
}

export function memberAnonymisationPipeline(): Document[] {
  const memberKey = {$toString: "$_id"};
  const placeholderEmail = {$concat: ["member-", memberKey, "@example.invalid"]};
  return [
    {
      $set: {
        firstName: "Member",
        lastName: memberKey,
        displayName: {$concat: ["Member ", memberKey]},
        userName: {$concat: ["member-", memberKey]},
        email: placeholderEmail,
        "mail.email": placeholderEmail
      }
    },
    {$unset: MEMBER_PERSONAL_FIELDS}
  ];
}

export async function sanitiseContributorClone(db: Db, keepMemberId: string | null): Promise<void> {
  const config = db.collection("config");
  await sanitiseDuplicatedDatabase(db, CONTRIBUTOR_LOCAL_SITE_URL);
  await config.updateOne({key: ConfigKey.MAILCHIMP}, {$set: {"value.apiKey": null}});
  await config.updateOne({key: ConfigKey.SALESFORCE}, {$set: {"value.apiKeysByGroupCode": {}, "value.enabled": false}});
  await config.deleteMany({key: {$in: CONTRIBUTOR_CLONE_REMOVED_CONFIG_KEYS}});
  await config.updateOne(
    {key: ConfigKey.PLATFORM_SEND_CONTROL},
    {$set: {key: ConfigKey.PLATFORM_SEND_CONTROL, value: contributorSendControl()}},
    {upsert: true}
  );
  await db.collection(member.collection.collectionName).updateMany(memberAnonymisationFilter(keepMemberId), memberAnonymisationPipeline());
}
