import { isBoolean, isEmpty, isNull, isNumber, isString, isUndefined } from "es-toolkit/compat";
import { MemberApplyContext, MemberApplyDates, MemberApplyOutcome, MemberMatchKeys } from "../models/member-bulk-apply.model";
import {
  Member,
  MemberAction,
  MemberAuditFieldChange,
  MemberMatchResult,
  MemberTerm,
  NONE,
  RamblersMember,
  RamblersMemberAndContact,
  UpdateAudit,
  WriteDataRule,
  WriteDataType
} from "../models/member.model";
import { MemberSyncNotificationCandidate, MemberSyncNotificationResolution } from "../models/member-sync-notification.model";
import { effectiveSyncMode, MemberSyncPolicyMode } from "../models/member-sync-policy.model";
import { AUDIT_FIELDS, AuditField } from "../models/ramblers-insight-hub.model";
import { MailProvider } from "../models/system.model";
import {
  applyAutoSubscribeDefaults,
  applyDefaultMailSettings,
  resetMailchimpUpdateStatus,
  unsubscribeFromAllLists
} from "./mail-subscription-defaults";
import { memberFullName } from "./member-names";
import { createDisplayNameFromMember, createUserName, removeCharactersNotPartOfName, uniqueValueAgainst } from "./member-naming";
import { asNumber } from "./numbers";
import { booleanOf } from "./strings";
import { fromTeamEmailsFeed, teamEmailsIgnoredReason } from "./team-emails-membership";

export const TEAM_EMAILS_IGNORED_RESOLUTION = "Ignored: would not be on Insight Hub";

const memberKeysCache = new WeakMap<Member, MemberMatchKeys>();
const takenValuesCache = new WeakMap<Member[], Map<string, {count: number; values: Set<string>}>>();

export function noValueFor(dataValue: any): boolean {
  return !isBoolean(dataValue) && (isEmpty(dataValue) || isUndefined(dataValue) || isNull(dataValue));
}

function normalizedText(value: string): string {
  return isString(value) ? value.trim().toLowerCase() : value ? String(value).trim().toLowerCase() : "";
}

function matchKeysFor(member: RamblersMember | Member, userName: string): MemberMatchKeys {
  return {
    salesforceId: normalizedText(member?.salesforceId),
    membershipNumber: member?.membershipNumber,
    userName: normalizedText(userName),
    firstOrTitle: normalizedText(member?.firstName || member?.title),
    firstName: normalizedText(member?.firstName),
    lastName: normalizedText(member?.lastName),
    title: normalizedText(member?.title),
    nameAlias: normalizedText((member as Member)?.nameAlias),
    email: normalizedText(member?.email),
  };
}

function existingMemberKeys(member: Member): MemberMatchKeys {
  const cached = memberKeysCache.get(member);
  const keys = cached ?? matchKeysFor(member, member.userName);
  if (!cached) {
    memberKeysCache.set(member, keys);
  }
  return keys;
}

function candidateKeys(ramblersMember: RamblersMember | Member): MemberMatchKeys {
  return matchKeysFor(ramblersMember, (ramblersMember as Member).userName || createUserName(ramblersMember));
}

function nameIndexMatches(ramblersMember: RamblersMember | Member, candidate: MemberMatchKeys, member: MemberMatchKeys, nameAlias: string): boolean {
  return !isEmpty(ramblersMember.firstName || ramblersMember.title)
    && !isEmpty(ramblersMember.lastName)
    && candidate.firstOrTitle === member.firstName
    && candidate.lastName === member.lastName
    && candidate.title === member.title
    && normalizedText(nameAlias) === member.nameAlias;
}

function matchTypeFor(ramblersMemberAndContact: RamblersMemberAndContact, candidate: MemberMatchKeys, member: Member): string | null {
  const ramblersMember = ramblersMemberAndContact.ramblersMember;
  const keys = existingMemberKeys(member);
  const contactMatchingEnabled = !!ramblersMemberAndContact?.contact;
  if (!isEmpty(ramblersMember?.salesforceId) && !isEmpty(member?.salesforceId) && candidate.salesforceId === keys.salesforceId) {
    return "Ramblers Team Emails contact id";
  } else if (!isEmpty(ramblersMember?.salesforceId) && isEmpty(member?.salesforceId) && !isEmpty(member?.membershipNumber) && candidate.salesforceId === normalizedText(member.membershipNumber)) {
    return "Ramblers Team Emails contact id";
  } else if (!isEmpty(ramblersMember?.membershipNumber) && member?.membershipNumber === ramblersMember?.membershipNumber) {
    return "membership number";
  } else if (!isEmpty(ramblersMember?.membershipNumber) && !isEmpty(member?.membershipNumber)) {
    return null;
  } else if (!isEmpty(candidate.userName) && candidate.userName === keys.userName) {
    return "user name";
  } else if (nameIndexMatches(ramblersMember, candidate, keys, (ramblersMember as unknown as Member).nameAlias)) {
    return "name and title";
  } else if (!isEmpty(ramblersMember.email) && !isEmpty(member.email) && candidate.email === keys.email && candidate.lastName === keys.lastName) {
    return "email and last name";
  } else if (contactMatchingEnabled && !isEmpty(ramblersMember.mobileNumber) && !isEmpty(member.mobileNumber) && asNumber(ramblersMember.mobileNumber) === asNumber(member.mobileNumber)) {
    return "mobile number";
  } else if (contactMatchingEnabled && removeCharactersNotPartOfName(ramblersMemberAndContact.contact.name) === removeCharactersNotPartOfName(member.displayName)) {
    return "display name";
  } else {
    return null;
  }
}

export function existingMemberMatchFor(ramblersMemberAndContact: RamblersMemberAndContact, existingMembers: Member[]): MemberMatchResult {
  const candidate = candidateKeys(ramblersMemberAndContact.ramblersMember);
  const member = existingMembers.find(existing => !!existing?.id && !!matchTypeFor(ramblersMemberAndContact, candidate, existing));
  return {member, memberMatchType: member ? matchTypeFor(ramblersMemberAndContact, candidate, member) : null};
}

function createUniqueNameAlias(ramblersMember: RamblersMember | Member, existingMembers: Member[]): string {
  const candidate = candidateKeys(ramblersMember);
  const baseAlias = ((ramblersMember as Member).nameAlias || "").trim();
  const aliasForOccurrence = (occurrence: number): string => occurrence === 1 ? baseAlias : baseAlias ? `${baseAlias} ${occurrence}` : `${occurrence}`;
  const sameName = existingMembers.filter(member => nameIndexMatches(ramblersMember, candidate, existingMemberKeys(member), existingMemberKeys(member).nameAlias));
  const takenAliases = new Set(sameName.map(member => existingMemberKeys(member).nameAlias));
  const maxOccurrences = existingMembers.length + 2;
  const firstFree = (occurrence: number): string => occurrence > maxOccurrences
    ? aliasForOccurrence(maxOccurrences + 1)
    : takenAliases.has(normalizedText(aliasForOccurrence(occurrence))) ? firstFree(occurrence + 1) : aliasForOccurrence(occurrence);
  return firstFree(1);
}

function takenValues(existingMembers: Member[], field: string): Set<string> {
  const byField = takenValuesCache.get(existingMembers) ?? new Map<string, {count: number; values: Set<string>}>();
  const cached = byField.get(field);
  const reusable = !!cached && cached.count <= existingMembers.length;
  const values = reusable ? cached.values : new Set<string>();
  existingMembers.slice(reusable ? cached.count : 0).map(member => member[field]).filter(value => !!value).forEach(value => values.add(value));
  byField.set(field, {count: existingMembers.length, values});
  takenValuesCache.set(existingMembers, byField);
  return values;
}

function uniqueValueFor(value: string, field: string, existingMembers: Member[]): string {
  return uniqueValueAgainst(value, takenValues(existingMembers, field), existingMembers.length + 1);
}

export function newMemberFor(ramblersMember: RamblersMember, existingMembers: Member[]): Member {
  const displayName = uniqueValueFor(createDisplayNameFromMember(ramblersMember), "displayName", existingMembers);
  const member: Member = {
    firstName: removeCharactersNotPartOfName(ramblersMember.firstName) || ramblersMember.firstName || null,
    lastName: removeCharactersNotPartOfName(ramblersMember.lastName) || ramblersMember.lastName || null,
    groupMember: true,
    socialMember: true,
    userName: uniqueValueFor(createUserName(ramblersMember), "userName", existingMembers),
    displayName,
    contactId: memberFullName(ramblersMember) || displayName,
    expiredPassword: true
  };
  const nameAlias = createUniqueNameAlias(ramblersMember, existingMembers);
  return nameAlias ? {...member, nameAlias} : member;
}

function formatValue(value: any, field: AuditField, dates: MemberApplyDates): any {
  if (value && field.type === WriteDataType.DATE) {
    return dates.displayDate(value);
  } else {
    return noValueFor(value) ? NONE : value;
  }
}

function readActualOrDerivedValue(field: AuditField, member: Member, ramblersMember: RamblersMember, dates: MemberApplyDates): any {
  const actualValue = ramblersMember[field.fieldName];
  if (!noValueFor(actualValue)) {
    return actualValue;
  } else if (field.memberDerivedValue) {
    return field.memberDerivedValue(member, dates);
  } else if (field.ramblersDerivedValue) {
    return field.ramblersDerivedValue(ramblersMember, dates);
  } else {
    return null;
  }
}

function newDataValueForField(field: AuditField, ramblersMember: RamblersMember, member: Member, dates: MemberApplyDates): any {
  const dataValue = readActualOrDerivedValue(field, member, ramblersMember, dates);
  if (field.type === WriteDataType.DATE) {
    return isString(dataValue) ? dates.asValueNoTime(dataValue, field.dateFormat) : isNumber(dataValue) ? dataValue : null;
  } else if (field.type === WriteDataType.BOOLEAN) {
    return booleanOf(dataValue);
  } else {
    return dataValue;
  }
}

function shouldClearExpiryDate(ramblersMember: RamblersMember): boolean {
  const memberStatus = ramblersMember.memberStatus?.toLowerCase();
  return noValueFor(ramblersMember.membershipExpiryDate) || ramblersMember.memberTerm === MemberTerm.LIFE || memberStatus === "payment pending";
}

function recentlyLoaded(member: Member, dates: MemberApplyDates): boolean {
  return !!member.createdDate && member.createdDate >= dates.monthsAgoNoTime(1);
}

function auditResolutionFor(effectiveMode: MemberSyncPolicyMode, performMemberUpdate: boolean): string {
  if (effectiveMode === MemberSyncPolicyMode.ALWAYS_APPLY_HEAD_OFFICE) {
    return "Head Office override";
  } else if (effectiveMode === MemberSyncPolicyMode.SKIP && !performMemberUpdate) {
    return "Kept (admin policy)";
  } else if (performMemberUpdate) {
    return "Updated";
  } else {
    return "Not overwritten";
  }
}

function notificationValue(formattedValue: any): string | null {
  return formattedValue === NONE || noValueFor(formattedValue) ? null : String(formattedValue);
}

function ruleBasedUpdate(field: AuditField, ramblersMember: RamblersMember, member: Member, newDataValue: any, oldDataValue: any, newFormattedValue: any, dataDifferent: boolean): boolean {
  const fieldName = field.fieldName;
  switch (field.writeDataIf) {
    case WriteDataRule.CHANGED:
      return !!(dataDifferent && ramblersMember[fieldName]);
    case WriteDataRule.NO_OLD_VALUE:
      return !!(newDataValue && !member[fieldName]);
    case WriteDataRule.TRANSITION_TO_TRUE_NEW_VALUE:
      return booleanOf(newDataValue) && !booleanOf(oldDataValue);
    case WriteDataRule.NOT_REVOKED:
      return !!(newFormattedValue && dataDifferent && !member.revoked);
    default:
      return !noValueFor(newDataValue);
  }
}

export function applyAuditField(context: MemberApplyContext, updateAudit: UpdateAudit, member: Member, ramblersMember: RamblersMember, field: AuditField, candidates: MemberSyncNotificationCandidate[]): void {
  const dates = context.dates;
  const fieldName: string = field.fieldName;
  const effectiveMode = effectiveSyncMode(context.syncPolicy, fieldName);
  const oldDataValue = member[field.fieldName];
  const oldFormattedValue = formatValue(oldDataValue, field, dates);
  const expiryField = fieldName === "membershipExpiryDate";
  const clearExpiry = expiryField && (shouldClearExpiryDate(ramblersMember) || recentlyLoaded(member, dates));
  const rawNewDataValue = newDataValueForField(field, ramblersMember, member, dates);
  const newDataValue = expiryField && !rawNewDataValue && clearExpiry ? null : rawNewDataValue;
  const newFormattedValue = formatValue(newDataValue, field, dates);
  const dataDifferent = oldFormattedValue.toString() !== newFormattedValue.toString();
  const expiryOrRuleUpdate = expiryField && !newDataValue && clearExpiry
    ? !!member.membershipExpiryDate
    : ruleBasedUpdate(field, ramblersMember, member, newDataValue, oldDataValue, newFormattedValue, dataDifferent);
  const creatingMember = !member.id;
  const performMemberUpdate = effectiveMode === MemberSyncPolicyMode.ALWAYS_APPLY_HEAD_OFFICE
    ? dataDifferent
    : effectiveMode === MemberSyncPolicyMode.SKIP
      ? creatingMember && dataDifferent && !noValueFor(newDataValue)
      : expiryOrRuleUpdate;
  if (performMemberUpdate) {
    (member as any)[fieldName] = newDataValue;
    updateAudit.fieldsChanged++;
  }
  if (dataDifferent) {
    if (!performMemberUpdate) {
      updateAudit.fieldsSkipped++;
    }
    updateAudit.fieldChanges.push({fieldName, from: String(oldFormattedValue), to: String(newFormattedValue), resolution: auditResolutionFor(effectiveMode, performMemberUpdate)});
  }
  if (member.id && effectiveMode !== MemberSyncPolicyMode.SKIP && dataDifferent && effectiveMode !== MemberSyncPolicyMode.ALWAYS_APPLY_HEAD_OFFICE && !performMemberUpdate) {
    candidates.push({
      memberId: member.id,
      fieldName,
      localValue: notificationValue(oldFormattedValue),
      headOfficeValue: notificationValue(newFormattedValue),
      resolution: MemberSyncNotificationResolution.KEPT_LOCAL_DIVERGENCE
    });
  }
}

export function applyTeamEmailsIgnoredReason(updateAudit: UpdateAudit, member: Member, ignoredReason: string | null): void {
  const previousReason = member.teamEmailsIgnoredReason || null;
  if (ignoredReason !== previousReason) {
    member.teamEmailsIgnoredReason = ignoredReason;
    updateAudit.fieldsChanged++;
    updateAudit.fieldChanges.push({
      fieldName: "teamEmailsIgnoredReason",
      from: previousReason || NONE,
      to: ignoredReason || NONE,
      resolution: ignoredReason ? TEAM_EMAILS_IGNORED_RESOLUTION : "No longer ignored"
    });
  }
  if (ignoredReason && member.groupMember !== false) {
    updateAudit.fieldsChanged++;
    updateAudit.fieldChanges.push({fieldName: "groupMember", from: String(!!member.groupMember), to: "false", resolution: TEAM_EMAILS_IGNORED_RESOLUTION});
    member.groupMember = false;
  }
}

export function applySalesforceId(updateAudit: UpdateAudit, member: Member, salesforceId: string): void {
  if (!isEmpty(salesforceId) && member.salesforceId !== salesforceId) {
    if (member.id) {
      updateAudit.fieldsChanged++;
      updateAudit.fieldChanges.push({fieldName: "salesforceId", from: member.salesforceId || NONE, to: salesforceId, resolution: "Updated"});
    }
    member.salesforceId = salesforceId;
  }
}

function mailSubscriptionChange(updateAudit: UpdateAudit, from: string, to: string, resolution: string): void {
  updateAudit.fieldsChanged++;
  updateAudit.fieldChanges.push({fieldName: "mailSubscriptions", from, to, resolution});
}

function memberActionFor(updateAudit: UpdateAudit, memberMatch: MemberAction): MemberAction {
  if (memberMatch === MemberAction.created) {
    return MemberAction.created;
  } else if (updateAudit.fieldsChanged > 0) {
    return MemberAction.updated;
  } else {
    return MemberAction.skipped;
  }
}

export function applyRamblersMember(context: MemberApplyContext, ramblersMember: RamblersMember, existingMembers: Member[]): MemberApplyOutcome {
  const match = existingMemberMatchFor({ramblersMember, contact: null}, existingMembers);
  const memberMatch = match.member ? MemberAction.found : MemberAction.created;
  const member: Member = match.member ?? newMemberFor(ramblersMember, existingMembers);
  if (!match.member) {
    existingMembers.push(member);
  } else if (context.mail.mailProvider === MailProvider.MAILCHIMP) {
    resetMailchimpUpdateStatus(member);
  }
  const previousEmailMarketingConsent = member.emailMarketingConsent;
  const updateAudit: UpdateAudit = {fieldChanges: [], fieldsChanged: 0, fieldsSkipped: 0};
  applySalesforceId(updateAudit, member, ramblersMember.salesforceId);
  const notificationCandidates: MemberSyncNotificationCandidate[] = [];
  const ignoredReason = teamEmailsIgnoredReason(ramblersMember);
  AUDIT_FIELDS
    .filter(field => !(ignoredReason && field.fieldName === "groupMember"))
    .forEach(field => applyAuditField(context, updateAudit, member, ramblersMember, field, notificationCandidates));
  if (memberMatch === MemberAction.created) {
    applyDefaultMailSettings(member, context.mail);
  }
  const brevo = context.mail.mailProvider === MailProvider.BREVO;
  const now = context.dates.now();
  if (brevo && context.mail.respectHeadOfficeConsent && member.emailMarketingConsent === false && unsubscribeFromAllLists(member, context.mail, now)) {
    mailSubscriptionChange(updateAudit, "subscribed", "unsubscribed", "Head office email marketing consent not given");
  }
  const consentRestored = previousEmailMarketingConsent === false && booleanOf(member.emailMarketingConsent);
  if (brevo && consentRestored && applyAutoSubscribeDefaults(member, context.mail, now)) {
    mailSubscriptionChange(updateAudit, "unsubscribed", "subscribed", "Head office email marketing consent restored");
  }
  if (fromTeamEmailsFeed(ramblersMember)) {
    applyTeamEmailsIgnoredReason(updateAudit, member, ignoredReason);
  }
  const fieldChanges: MemberAuditFieldChange[] = updateAudit.fieldChanges;
  memberKeysCache.delete(member);
  return {
    member,
    memberMatch,
    memberAction: memberActionFor(updateAudit, memberMatch),
    fieldChanges,
    changes: updateAudit.fieldsChanged,
    notificationCandidates
  };
}
