import { Db, MongoClient } from "mongodb";
import createMigrationLogger from "../migrations-logger";
import { CONFIG_COLLECTION, MEMBERS_COLLECTION } from "../shared/collection-names";
import { ConfigKey } from "../../../../../projects/ngx-ramblers/src/app/models/config.model";
import { Member } from "../../../../../projects/ngx-ramblers/src/app/models/member.model";
import { defaultVolunteerRoleCategories, knownVolunteerRoles, volunteerRoleList } from "../../../../../projects/ngx-ramblers/src/app/functions/volunteer-roles";

const debugLog = createMigrationLogger("default-volunteer-role-categories");

export async function up(db: Db, _client: MongoClient) {
  const configCollection = db.collection(CONFIG_COLLECTION);
  const systemConfig = await configCollection.findOne({key: ConfigKey.SYSTEM});
  const existingCategories = systemConfig?.value?.volunteers?.roleCategories ?? [];
  if (!systemConfig?.value) {
    debugLog("No system config found - skipping default volunteer role categories");
  } else if (existingCategories.length > 0) {
    debugLog("Volunteer role categories already set (%d) - leaving them alone", existingCategories.length);
  } else {
    const members = await db.collection<Member>(MEMBERS_COLLECTION)
      .find({volunteerRoles: {$nin: [null, ""]}}, {projection: {volunteerRoles: 1}})
      .toArray() as Member[];
    const roles = [...knownVolunteerRoles(), ...members.flatMap(member => volunteerRoleList(member))];
    const roleCategories = defaultVolunteerRoleCategories(roles);
    if (roleCategories.length > 0) {
      await configCollection.updateOne({key: ConfigKey.SYSTEM}, {$set: {"value.volunteers.roleCategories": roleCategories}});
      debugLog("Set %d default volunteer role categories: %o", roleCategories.length, roleCategories);
    } else {
      debugLog("No volunteer roles matched a default category - none set");
    }
  }
}

export async function down(db: Db, _client: MongoClient) {
  await db.collection(CONFIG_COLLECTION).updateOne({key: ConfigKey.SYSTEM}, {$unset: {"value.volunteers.roleCategories": 1}});
  debugLog("Removed volunteer role categories");
}
