import { Db, MongoClient } from "mongodb";
import { MemberAuditFieldChange } from "../../../../../projects/ngx-ramblers/src/app/models/member.model";
import createMigrationLogger from "../migrations-logger";
import { MEMBER_UPDATE_AUDIT_COLLECTION } from "../shared/collection-names";

const debugLog = createMigrationLogger("remove-phantom-view-as-member-audit-changes");

export const PHANTOM_VIEW_AS_MEMBER_CHANGE: MemberAuditFieldChange = {fieldName: "viewAsMember", from: "(none)", to: "false", resolution: "Edited"};

export async function up(db: Db, _client: MongoClient): Promise<void> {
  const audits = db.collection<{changes: number; fieldChanges: MemberAuditFieldChange[]}>(MEMBER_UPDATE_AUDIT_COLLECTION);
  const deleted = await audits.deleteMany({fieldChanges: {$size: 1, $elemMatch: PHANTOM_VIEW_AS_MEMBER_CHANGE}});
  const trimmed = await audits.updateMany(
    {fieldChanges: {$elemMatch: PHANTOM_VIEW_AS_MEMBER_CHANGE}},
    {$pull: {fieldChanges: PHANTOM_VIEW_AS_MEMBER_CHANGE}, $inc: {changes: -1}}
  );
  debugLog("Removed %s audit row(s) that only recorded View As Member (none) to false, and removed that entry from %s row(s) that also record real changes", deleted.deletedCount, trimmed.modifiedCount);
}

export async function down(_db: Db, _client: MongoClient): Promise<void> {
  debugLog("Removed audit entries recorded a change that never happened, so they are not restored");
}
