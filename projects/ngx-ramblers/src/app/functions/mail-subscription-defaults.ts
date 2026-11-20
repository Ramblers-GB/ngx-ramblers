import { booleanOf } from "./strings";
import { ListInfo, ListSetting, MailConfig, MailMessagingConfig, MailSubscription } from "../models/mail.model";
import { MailProvider, SystemConfig } from "../models/system.model";
import { MemberApplyMailContext } from "../models/member-bulk-apply.model";
import { Member } from "../models/member.model";

export function subscribedByDefault(listSetting: ListSetting, member: Member): boolean {
  if (member?.emailBlock) {
    return false;
  } else {
    return listSetting?.autoSubscribeNewMembers && (listSetting?.requiresMemberEmailMarketingConsent ? member?.emailMarketingConsent : true) && !!(member.email);
  }
}

export function listSettingFor(mail: MemberApplyMailContext, listId: number): ListSetting {
  return mail?.listSettings?.find(setting => setting?.id === listId);
}

export function subscriptionFor(member: Member, listId: number): MailSubscription {
  return member?.mail?.subscriptions?.find(subscription => subscription.id === listId);
}

export function marketingConsentBlocksSubscribeToList(member: Member, listId: number, mail: MemberApplyMailContext): boolean {
  if (member?.emailMarketingConsent !== false) {
    return false;
  } else if (mail?.respectHeadOfficeConsent) {
    return true;
  } else {
    return !!listSettingFor(mail, listId)?.requiresMemberEmailMarketingConsent;
  }
}

export function setSubscription(member: Member, listId: number, subscribed: boolean, mail: MemberApplyMailContext, now: number): void {
  const nextSubscribed = subscribed && marketingConsentBlocksSubscribeToList(member, listId, mail) ? false : subscribed;
  if (!member.mail) {
    member.mail = {subscriptions: [], email: member.email, id: null};
  }
  if (!member.mail.subscriptions) {
    member.mail.subscriptions = [];
  }
  const existing: MailSubscription = subscriptionFor(member, listId);
  const wasSubscribed = !!existing?.subscribed;
  const subscription: MailSubscription = existing || {id: listId, subscribed: nextSubscribed};
  subscription.subscribed = nextSubscribed;
  if (nextSubscribed) {
    subscription.unsubscribedAt = undefined;
  } else if (wasSubscribed) {
    subscription.unsubscribedAt = now;
  }
  if (!existing) {
    member.mail.subscriptions.push(subscription);
  }
}

export function unsubscribeFromAllLists(member: Member, mail: MemberApplyMailContext, now: number): boolean {
  const subscribed: MailSubscription[] = (member?.mail?.subscriptions ?? []).filter(subscription => subscription.subscribed);
  subscribed.forEach(subscription => setSubscription(member, subscription.id, false, mail, now));
  return subscribed.length > 0;
}

export function initialiseSubscriptionsFromLists(member: Member, mail: MemberApplyMailContext): void {
  member.mail = {
    email: null,
    id: null,
    subscriptions: mail?.brevoListIds?.map(listId => ({id: listId, subscribed: subscribedByDefault(listSettingFor(mail, listId), member)}))
  };
}

export function applyAutoSubscribeDefaults(member: Member, mail: MemberApplyMailContext, now: number): boolean {
  const listIds = mail?.brevoListIds ?? [];
  if (listIds.length === 0) {
    return false;
  } else if (!member.mail?.subscriptions?.length) {
    initialiseSubscriptionsFromLists(member, mail);
    return (member.mail?.subscriptions ?? []).some(subscription => subscription.subscribed);
  } else {
    return listIds.reduce((changed, listId) => {
      const shouldSubscribe = subscribedByDefault(listSettingFor(mail, listId), member);
      if (shouldSubscribe && !subscriptionFor(member, listId)?.subscribed) {
        setSubscription(member, listId, true, mail, now);
        return true;
      } else {
        return changed;
      }
    }, false);
  }
}

export function defaultMailchimpSettings(member: Member, subscribedState: boolean): void {
  member.mailchimpLists = {
    walks: {subscribed: subscribedState},
    socialEvents: {subscribed: subscribedState},
    general: {subscribed: subscribedState}
  };
}

export function resetMailchimpUpdateStatus(member: Member): void {
  if (member) {
    const lists: any = member.mailchimpLists ?? {};
    ["walks", "socialEvents", "general"].forEach(listType => {
      lists[listType] = {...(lists[listType] ?? {}), updated: false};
    });
    member.mailchimpLists = lists;
  }
}

export function mailContextFromParts(mailConfig: MailConfig, brevoListIds: number[], systemConfig: SystemConfig): MemberApplyMailContext {
  return {
    mailProvider: systemConfig?.mailDefaults?.mailProvider ?? MailProvider.NONE,
    respectHeadOfficeConsent: booleanOf(mailConfig?.respectHeadOfficeConsent, true),
    brevoListIds: brevoListIds ?? [],
    listSettings: mailConfig?.listSettings ?? [],
    autoSubscribeNewMembers: !!systemConfig?.mailDefaults?.autoSubscribeNewMembers,
  };
}

export function mailContextFrom(mailMessagingConfig: MailMessagingConfig, systemConfig: SystemConfig): MemberApplyMailContext {
  return mailContextFromParts(mailMessagingConfig?.mailConfig, (mailMessagingConfig?.brevo?.lists?.lists ?? []).map((list: ListInfo) => list.id), systemConfig);
}

export function applyDefaultMailSettings(member: Member, mail: MemberApplyMailContext): Member {
  member.groupMember = true;
  if (mail?.mailProvider === MailProvider.BREVO) {
    initialiseSubscriptionsFromLists(member, mail);
  } else if (mail?.mailProvider === MailProvider.MAILCHIMP) {
    defaultMailchimpSettings(member, mail.autoSubscribeNewMembers);
  }
  return member;
}
