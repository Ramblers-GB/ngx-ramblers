import { describe, expect, it } from "vitest";
import { applyAuditField, applyRamblersMember, applySalesforceId, applyTeamEmailsIgnoredReason, existingMemberMatchFor } from "./member-bulk-apply";
import { memberApplyDates } from "./member-apply-dates";
import { abbreviatedWalksManagerContactName } from "./member-names";
import { MemberApplyContext } from "../models/member-bulk-apply.model";
import { Member, MemberAction, RamblersMember, UpdateAudit, WriteDataRule } from "../models/member.model";
import { MemberSyncNotificationCandidate, MemberSyncNotificationResolution } from "../models/member-sync-notification.model";
import { MemberSyncPolicyMode } from "../models/member-sync-policy.model";
import { AUDIT_FIELDS, InsightHubDateFormat } from "../models/ramblers-insight-hub.model";
import { MailProvider } from "../models/system.model";

function contextWith(defaultMode: MemberSyncPolicyMode = MemberSyncPolicyMode.USE_LEGACY_RULES, mailProvider: MailProvider = MailProvider.BREVO): MemberApplyContext {
  return {
    dates: memberApplyDates(),
    syncPolicy: {defaultMode, overrides: {}},
    mail: {mailProvider, respectHeadOfficeConsent: true, brevoListIds: [1], listSettings: [{id: 1, autoSubscribeNewMembers: true, memberSubscribable: true, requiresMemberEmailMarketingConsent: false}], autoSubscribeNewMembers: true}
  };
}

function emptyAudit(): UpdateAudit {
  return {fieldChanges: [], fieldsChanged: 0, fieldsSkipped: 0};
}

function applyField(context: MemberApplyContext, fieldName: string, member: Member, ramblersMember: RamblersMember, candidates: MemberSyncNotificationCandidate[] = []): UpdateAudit {
  const updateAudit = emptyAudit();
  applyAuditField(context, updateAudit, member, ramblersMember, AUDIT_FIELDS.find(field => field.fieldName === fieldName), candidates);
  return updateAudit;
}

describe("member-bulk-apply", () => {
  describe("member matching", () => {
    it("matches by generated user name before creating a duplicate", () => {
      const existing = {id: "existing", firstName: "Wendy", lastName: "Williams", title: "Ms", userName: "wendy.williams"} as Member;
      const result = existingMemberMatchFor({ramblersMember: {firstName: "Wendy", lastName: "Williams", title: "Ms"} as RamblersMember, contact: null}, [existing]);
      expect(result.member).toBe(existing);
      expect(result.memberMatchType).toBe("user name");
    });

    it("matches by the unique name and title index", () => {
      const existing = {id: "existing", firstName: "Wendy", lastName: "Williams", title: "Ms", userName: "different.user"} as Member;
      const result = existingMemberMatchFor({ramblersMember: {firstName: "Wendy", lastName: "Williams", title: "Ms"} as RamblersMember, contact: null}, [existing]);
      expect(result.member).toBe(existing);
      expect(result.memberMatchType).toBe("name and title");
    });

    it("treats same-named members with different membership numbers as different people and gives the new one a name alias", () => {
      const existing = {id: "existing", membershipNumber: "100", firstName: "Wendy", lastName: "Williams", title: "Ms", userName: "wendy.williams"} as Member;
      const members = [existing];
      const outcome = applyRamblersMember(contextWith(), {firstName: "Wendy", lastName: "Williams", title: "Ms", membershipNumber: "200"} as RamblersMember, members);
      expect(outcome.memberMatch).toBe(MemberAction.created);
      expect(outcome.member.nameAlias).toBe("2");
      expect(outcome.member.userName).toBe("wendy.williams1");
    });

    it("does not match a member created earlier in the same load", () => {
      const members: Member[] = [];
      applyRamblersMember(contextWith(), {firstName: "Ann", lastName: "Lee", membershipNumber: "1"} as RamblersMember, members);
      expect(existingMemberMatchFor({ramblersMember: {firstName: "Ann", lastName: "Lee"} as RamblersMember, contact: null}, members).member).toBeUndefined();
    });
  });

  describe("contact ids", () => {
    it("records a newly gained contact id as a change so the member is saved", () => {
      const existing = {id: "existing", membershipNumber: "5", firstName: "Jo", lastName: "Hart"} as Member;
      const outcome = applyRamblersMember(contextWith(MemberSyncPolicyMode.USE_LEGACY_RULES, MailProvider.NONE), {membershipNumber: "5", firstName: "Jo", lastName: "Hart", salesforceId: "003ABC"} as RamblersMember, [existing]);
      expect(outcome.member.salesforceId).toBe("003ABC");
      expect(outcome.memberAction).toBe(MemberAction.updated);
      expect(outcome.fieldChanges.find(change => change.fieldName === "salesforceId")).toEqual({fieldName: "salesforceId", from: "(none)", to: "003ABC", resolution: "Updated"});
    });

    it("records nothing when the contact id is unchanged", () => {
      const updateAudit = emptyAudit();
      applySalesforceId(updateAudit, {id: "existing", salesforceId: "003ABC"} as Member, "003ABC");
      expect(updateAudit.fieldsChanged).toBe(0);
    });
  });

  describe("unique names in one load", () => {
    it("gives each new member with the same name its own user name and display name", () => {
      const members: Member[] = [];
      const names = ["1", "2", "3"].map(membershipNumber => applyRamblersMember(contextWith(), {firstName: "Ann", lastName: "Lee", membershipNumber} as RamblersMember, members).member);
      expect(names.map(member => member.userName)).toEqual(["ann.lee", "ann.lee1", "ann.lee2"]);
      expect(names.map(member => member.displayName)).toEqual(["Ann L", "Ann L1", "Ann L2"]);
    });
  });

  describe("Walks Manager contact name", () => {
    it("sets contactId to the full name so created members pass walk export validation", () => {
      const outcome = applyRamblersMember(contextWith(), {firstName: "Gillian", lastName: "Smith", title: "Miss", membershipNumber: "3158100"} as RamblersMember, []);
      expect(outcome.member.displayName).toBe("Gillian S");
      expect(outcome.member.contactId).toBe("Gillian Smith");
      expect(abbreviatedWalksManagerContactName(outcome.member.contactId)).toBe(false);
    });
  });

  describe("member sync notifications", () => {
    it("does not queue a notification when Head office values are applied automatically", () => {
      const candidates: MemberSyncNotificationCandidate[] = [];
      applyField(contextWith(MemberSyncPolicyMode.ALWAYS_APPLY_HEAD_OFFICE), "email", {id: "member-1", email: "old@example.org"} as Member, {email: "new@example.org"} as RamblersMember, candidates);
      expect(candidates).toEqual([]);
    });

    it("queues a notification when a differing local value is kept", () => {
      const candidates: MemberSyncNotificationCandidate[] = [];
      applyField(contextWith(), "email", {id: "member-1", email: "local@example.org"} as Member, {email: "head-office@example.org"} as RamblersMember, candidates);
      expect(candidates).toEqual([{memberId: "member-1", fieldName: "email", localValue: "local@example.org", headOfficeValue: "head-office@example.org", resolution: MemberSyncNotificationResolution.KEPT_LOCAL_DIVERGENCE}]);
    });
  });

  describe("skip policy", () => {
    it("populates firstName on a new member", () => {
      const member = {firstName: null} as Member;
      const updateAudit = applyField(contextWith(MemberSyncPolicyMode.SKIP), "firstName", member, {firstName: "Gillian", lastName: "Smith"} as RamblersMember);
      expect(member.firstName).toBe("Gillian");
      expect(updateAudit.fieldChanges[0].resolution).toBe("Updated");
    });

    it("keeps the local firstName on an existing member", () => {
      const member = {id: "existing", firstName: "Local"} as Member;
      const updateAudit = applyField(contextWith(MemberSyncPolicyMode.SKIP), "firstName", member, {firstName: "Gillian"} as RamblersMember);
      expect(member.firstName).toBe("Local");
      expect(updateAudit.fieldChanges[0].resolution).toBe("Kept (admin policy)");
    });
  });

  describe("dates", () => {
    it("parses Insight Hub two-digit-year expiry dates", () => {
      const member = {id: "existing"} as Member;
      applyField(contextWith(MemberSyncPolicyMode.ALWAYS_APPLY_HEAD_OFFICE), "membershipExpiryDate", member, {membershipExpiryDate: "15/07/27"} as RamblersMember);
      expect(new Date(member.membershipExpiryDate).getUTCFullYear()).toBe(2027);
    });

    it("keeps the expiry date rule and formats used for Insight Hub exports", () => {
      const field = AUDIT_FIELDS.find(auditField => auditField.fieldName === "membershipExpiryDate");
      expect(field.writeDataIf).toBe(WriteDataRule.CHANGED);
      expect(field.dateFormat).toBe(InsightHubDateFormat.TWO_DIGIT_YEAR);
      expect(AUDIT_FIELDS.find(auditField => auditField.fieldName === "emailPermissionLastUpdated").dateFormat).toBe(InsightHubDateFormat.FOUR_DIGIT_YEAR);
    });
  });

  describe("Team Emails members who would not be on Insight Hub", () => {
    it("stops treating an ignored member as a group member and records why", () => {
      const member = {id: "member-1", groupMember: true} as Member;
      const updateAudit = emptyAudit();
      applyTeamEmailsIgnoredReason(updateAudit, member, "Membership suspended");
      expect(member.groupMember).toBe(false);
      expect(updateAudit.fieldChanges.map(change => change.fieldName)).toEqual(["teamEmailsIgnoredReason", "groupMember"]);
    });

    it("keeps a newly created ignored member out of the group even after mail defaults are applied", () => {
      const outcome = applyRamblersMember(contextWith(), {firstName: "Sam", lastName: "Reed", email: "sam@example.org", membershipNumber: "9", memberStatus: "Suspended", salesforceTeamStatus: "Member"} as RamblersMember, []);
      expect(outcome.memberMatch).toBe(MemberAction.created);
      expect(outcome.member.groupMember).toBe(false);
      expect(outcome.member.teamEmailsIgnoredReason).toBe("Membership suspended");
    });

    it("does not touch mail subscriptions, so nothing is written back to Head office", () => {
      const member = {id: "member-1", groupMember: true, mail: {subscriptions: [{id: 1, subscribed: true}]}} as unknown as Member;
      applyTeamEmailsIgnoredReason(emptyAudit(), member, "Membership lapsed");
      expect(member.mail.subscriptions).toEqual([{id: 1, subscribed: true}]);
    });

    it("clears the reason when the member would be on Insight Hub again", () => {
      const member = {id: "member-1", groupMember: false, teamEmailsIgnoredReason: "Membership suspended"} as Member;
      const updateAudit = emptyAudit();
      applyTeamEmailsIgnoredReason(updateAudit, member, null);
      expect(member.teamEmailsIgnoredReason).toBeNull();
      expect(updateAudit.fieldChanges[0].resolution).toBe("No longer ignored");
    });
  });

  describe("consent", () => {
    it("unsubscribes a member from every list when Head office consent is not given", () => {
      const existing = {id: "existing", membershipNumber: "5", firstName: "Jo", lastName: "Hart", emailMarketingConsent: true, mail: {subscriptions: [{id: 1, subscribed: true}]}} as unknown as Member;
      const outcome = applyRamblersMember(contextWith(), {membershipNumber: "5", firstName: "Jo", lastName: "Hart", emailMarketingConsent: "false"} as unknown as RamblersMember, [existing]);
      expect(outcome.member.mail.subscriptions[0].subscribed).toBe(false);
      expect(outcome.fieldChanges.some(change => change.resolution === "Head office email marketing consent not given")).toBe(true);
    });
  });
});
