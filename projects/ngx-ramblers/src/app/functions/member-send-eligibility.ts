import { isNumber } from "es-toolkit/compat";
import { Member, MemberCookie } from "../models/member.model";
import { MemberSendBlockReason, MemberSendRules } from "../models/email-composer.model";

export function memberSubscribedToList(member: Member, listId: number): boolean {
  return !!member?.groupMember && !!member?.email && (member?.mail?.subscriptions ?? []).some(subscription => subscription.id === listId && subscription.subscribed);
}

export function memberSubscribedToAnyList(member: Member): boolean {
  return !!member?.groupMember && !!member?.email && (member?.mail?.subscriptions ?? []).some(subscription => subscription.subscribed);
}

export function listUnsubscribedAt(member: Member, listId: number): number | null {
  const subscription = (member?.mail?.subscriptions ?? []).find(item => item.id === listId && !item.subscribed && isNumber(item.unsubscribedAt));
  return subscription?.unsubscribedAt ?? null;
}

export function fullyUnsubscribedAt(member: Member): number | null {
  const subscriptions = member?.mail?.subscriptions ?? [];
  const unsubscribeDates = subscriptions.filter(item => isNumber(item.unsubscribedAt)).map(item => item.unsubscribedAt);
  return subscriptions.some(item => item.subscribed) || unsubscribeDates.length === 0 ? null : Math.max(...unsubscribeDates);
}

function unsubscribeReason(member: Member, referenceListId: number | null): MemberSendBlockReason | null {
  if (isNumber(referenceListId)) {
    return isNumber(listUnsubscribedAt(member, referenceListId)) ? MemberSendBlockReason.UNSUBSCRIBED_FROM_LIST : null;
  } else {
    return isNumber(fullyUnsubscribedAt(member)) ? MemberSendBlockReason.UNSUBSCRIBED_FROM_ALL : null;
  }
}

export function memberSendBlockReason(member: Member, rules: MemberSendRules): MemberSendBlockReason | null {
  const blockReason = rules.respectEmailBlocks && member?.emailBlock ? MemberSendBlockReason.BLOCKED : null;
  const unsubscribed = !blockReason && rules.respectEmailBlocks && member ? unsubscribeReason(member, rules.referenceListId) : null;
  const noConsent = rules.respectHeadOfficeConsent && member?.emailMarketingConsent === false ? MemberSendBlockReason.NO_MARKETING_CONSENT : null;
  return blockReason ?? unsubscribed ?? noConsent;
}

export function emailComposerAllowed(member: Partial<MemberCookie>): boolean {
  return !!(member?.committee || member?.socialAdmin || member?.walkAdmin);
}
