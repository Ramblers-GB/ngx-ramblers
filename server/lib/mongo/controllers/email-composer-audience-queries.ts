import mongoose, { FilterQuery } from "mongoose";
import { isNumber, keys, values } from "es-toolkit/compat";
import { Member, MemberBulkLoadDateMap, MemberTerm } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { MemberSelection } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import {
  ComposerAudienceDefinition,
  ComposerAudienceScope,
  ComposerFilterSelectionRequest,
  ComposerFilterSelectionSettings,
  MemberSelectionWindow,
  MemberSendBlockReason,
  MemberSendRules
} from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { deliverabilityOptional, workflowRemovesRecipients } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer-audience";

const NOTHING: FilterQuery<Member> = {_id: {$in: []}};
const HAS_EMAIL: FilterQuery<Member> = {email: {$nin: [null, ""]}};

function all(...queries: FilterQuery<Member>[]): FilterQuery<Member> {
  const parts = queries.filter(query => keys(query).length > 0);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : {$and: parts};
}

function memberIdsIn(ids: string[]): FilterQuery<Member> {
  return {_id: {$in: (ids ?? []).filter(id => mongoose.isValidObjectId(id))}};
}

export function emailableGroupMemberQuery(): FilterQuery<Member> {
  return all({groupMember: true}, HAS_EMAIL);
}

export function listSubscriberQuery(listId: number): FilterQuery<Member> {
  return all(emailableGroupMemberQuery(), {"mail.subscriptions": {$elemMatch: {id: listId, subscribed: true}}});
}

function expiredMemberQuery(window: MemberSelectionWindow): FilterQuery<Member> {
  const eligible = all(
    {groupMember: true},
    {membershipExpiryDate: {$gt: 0}},
    {memberStatus: {$not: /^payment pending$/i}},
    {memberTerm: {$ne: MemberTerm.LIFE}}
  );
  return window.noDateFilter
    ? all(eligible, {membershipExpiryDate: {$lt: window.today}})
    : all(eligible, {membershipExpiryDate: {$lt: window.windowStart}}, {createdDate: {$not: {$gte: window.windowStart}}}, {updatedDate: {$not: {$gte: window.windowStart}}});
}

function bulkLoadMembershipNumbers(bulkLoadDateMap: MemberBulkLoadDateMap | null, matches: (date: number) => boolean): string[] {
  const dateMap = bulkLoadDateMap ?? {};
  return keys(dateMap).filter(membershipNumber => !!membershipNumber && !!dateMap[membershipNumber] && matches(dateMap[membershipNumber]));
}

export function memberSelectionQuery(key: MemberSelection, window: MemberSelectionWindow, bulkLoadDateMap: MemberBulkLoadDateMap | null): FilterQuery<Member> {
  if (key === MemberSelection.RECENTLY_ADDED) {
    return all({groupMember: true}, {createdDate: window.noDateFilter ? {$gt: 0} : {$gt: 0, $gte: window.windowStart}});
  } else if (key === MemberSelection.EXPIRED_MEMBERS) {
    return expiredMemberQuery(window);
  } else if (key === MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS) {
    return all({groupMember: true}, {membershipNumber: {$in: bulkLoadMembershipNumbers(bulkLoadDateMap, date => window.noDateFilter || date < window.windowStart)}});
  } else if (key === MemberSelection.ADDED_IN_LAST_BULK_LOAD_MEMBERS) {
    const dates = values(bulkLoadDateMap ?? {});
    const latest = dates.length ? Math.max(...dates) : 0;
    return latest
      ? all({groupMember: true}, {membershipNumber: {$in: bulkLoadMembershipNumbers(bulkLoadDateMap, date => date === latest)}}, {createdDate: {$gte: latest}})
      : NOTHING;
  } else {
    return NOTHING;
  }
}

function unsubscribedQuery(referenceListId: number | null): FilterQuery<Member> {
  return isNumber(referenceListId)
    ? {"mail.subscriptions": {$elemMatch: {id: referenceListId, subscribed: {$ne: true}, unsubscribedAt: {$type: "number"}}}}
    : all({"mail.subscriptions": {$not: {$elemMatch: {subscribed: true}}}}, {"mail.subscriptions.unsubscribedAt": {$type: "number"}});
}

const BLOCKED: FilterQuery<Member> = {emailBlock: {$exists: true, $ne: null}};
const NO_CONSENT: FilterQuery<Member> = {emailMarketingConsent: false};

export function sendBlockReasonQuery(reason: MemberSendBlockReason, rules: MemberSendRules): FilterQuery<Member> {
  if (reason === MemberSendBlockReason.BLOCKED) {
    return rules.respectEmailBlocks ? BLOCKED : NOTHING;
  } else if (reason === MemberSendBlockReason.UNSUBSCRIBED_FROM_LIST) {
    return rules.respectEmailBlocks && isNumber(rules.referenceListId) ? all({$nor: [BLOCKED]}, unsubscribedQuery(rules.referenceListId)) : NOTHING;
  } else if (reason === MemberSendBlockReason.UNSUBSCRIBED_FROM_ALL) {
    return rules.respectEmailBlocks && !isNumber(rules.referenceListId) ? all({$nor: [BLOCKED]}, unsubscribedQuery(null)) : NOTHING;
  } else if (reason === MemberSendBlockReason.NO_MARKETING_CONSENT) {
    return rules.respectHeadOfficeConsent
      ? all(rules.respectEmailBlocks ? {$nor: [BLOCKED, unsubscribedQuery(rules.referenceListId)]} : {}, NO_CONSENT)
      : NOTHING;
  } else {
    return NOTHING;
  }
}

export function sendableQuery(rules: MemberSendRules): FilterQuery<Member> {
  const blocking = [
    ...(rules.respectEmailBlocks ? [BLOCKED, unsubscribedQuery(rules.referenceListId)] : []),
    ...(rules.respectHeadOfficeConsent ? [NO_CONSENT] : [])
  ];
  return blocking.length ? {$nor: blocking} : {};
}

function scopeQuery(definition: ComposerAudienceDefinition, window: MemberSelectionWindow, bulkLoadDateMap: MemberBulkLoadDateMap | null): FilterQuery<Member> {
  if (definition.scope === ComposerAudienceScope.EVERYONE) {
    return emailableGroupMemberQuery();
  } else if (definition.scope === ComposerAudienceScope.MAILING_LIST) {
    return isNumber(definition.listId) ? listSubscriberQuery(definition.listId) : NOTHING;
  } else if (definition.scope === ComposerAudienceScope.MEMBER_FILTER) {
    return all(emailableGroupMemberQuery(), definition.preFilterKey ? memberSelectionQuery(definition.preFilterKey, window, bulkLoadDateMap) : {});
  } else {
    return NOTHING;
  }
}

export function audienceQuery(definition: ComposerAudienceDefinition, window: MemberSelectionWindow, bulkLoadDateMap: MemberBulkLoadDateMap | null): FilterQuery<Member> {
  const narrowed = all(scopeQuery(definition, window, bulkLoadDateMap), isNumber(definition.narrowListId) ? listSubscriberQuery(definition.narrowListId) : {});
  const named = (definition.memberIds ?? []).length > 0 ? [memberIdsIn(definition.memberIds)] : [];
  const excluded = (definition.excludedMemberIds ?? []).length > 0 ? {$nor: [memberIdsIn(definition.excludedMemberIds)]} : {};
  return all({$or: [narrowed, ...named]}, excluded);
}

export function filterSelectionQueries(request: ComposerFilterSelectionRequest, settings: ComposerFilterSelectionSettings | null, rules: MemberSendRules,
                                       window: MemberSelectionWindow, bulkLoadDateMap: MemberBulkLoadDateMap | null): {candidates: FilterQuery<Member>; available: FilterQuery<Member>; matching: FilterQuery<Member>} {
  const preFilterKey = request.preFilterKey ?? null;
  const candidates = all(
    workflowRemovesRecipients(settings) ? {} : {groupMember: true},
    isNumber(request.narrowListId) ? listSubscriberQuery(request.narrowListId) : {}
  );
  const available = all(
    candidates,
    deliverabilityOptional(settings, preFilterKey) ? {} : all(HAS_EMAIL, sendableQuery(rules))
  );
  return {candidates, available, matching: all(available, preFilterKey ? memberSelectionQuery(preFilterKey, window, bulkLoadDateMap) : {})};
}
