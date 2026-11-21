import { describe, expect, it } from "vitest";
import { emailComposerAllowed, fullyUnsubscribedAt, listUnsubscribedAt, memberSendBlockReason, memberSubscribedToList } from "./member-send-eligibility";
import { Member, MemberCookie } from "../models/member.model";
import { MemberSendBlockReason, MemberSendRules } from "../models/email-composer.model";

const allRules: MemberSendRules = {respectEmailBlocks: true, respectHeadOfficeConsent: true, referenceListId: null};

function member(overrides: Partial<Member> = {}): Member {
  return {id: "m1", email: "jo@example.com", groupMember: true, mail: {subscriptions: [{id: 3, subscribed: true}]}, ...overrides} as Member;
}

describe("member-send-eligibility", () => {
  it("treats a group member with an email address and a live subscription as subscribed", () => {
    expect(memberSubscribedToList(member(), 3)).toBe(true);
    expect(memberSubscribedToList(member({groupMember: false}), 3)).toBe(false);
    expect(memberSubscribedToList(member({email: ""}), 3)).toBe(false);
    expect(memberSubscribedToList(member(), 4)).toBe(false);
  });

  it("finds when a member left one list, and when they left every list", () => {
    const left = member({mail: {subscriptions: [{id: 3, subscribed: false, unsubscribedAt: 100}, {id: 4, subscribed: false, unsubscribedAt: 200}]}} as Partial<Member>);
    expect(listUnsubscribedAt(left, 3)).toBe(100);
    expect(fullyUnsubscribedAt(left)).toBe(200);
    expect(fullyUnsubscribedAt(member())).toBeNull();
  });

  it("gives the first reason a member cannot be emailed, in order: blocked, unsubscribed, no consent", () => {
    expect(memberSendBlockReason(member({emailBlock: {reasonCode: "hardBounce"}} as Partial<Member>), allRules)).toBe(MemberSendBlockReason.BLOCKED);
    expect(memberSendBlockReason(member({mail: {subscriptions: [{id: 3, subscribed: false, unsubscribedAt: 100}]}} as Partial<Member>), allRules)).toBe(MemberSendBlockReason.UNSUBSCRIBED_FROM_ALL);
    expect(memberSendBlockReason(member({mail: {subscriptions: [{id: 3, subscribed: false, unsubscribedAt: 100}]}} as Partial<Member>), {...allRules, referenceListId: 3})).toBe(MemberSendBlockReason.UNSUBSCRIBED_FROM_LIST);
    expect(memberSendBlockReason(member({emailMarketingConsent: false}), allRules)).toBe(MemberSendBlockReason.NO_MARKETING_CONSENT);
    expect(memberSendBlockReason(member(), allRules)).toBeNull();
  });

  it("ignores blocks and unsubscribes unless the site respects them, and consent unless it is required", () => {
    const noRules: MemberSendRules = {respectEmailBlocks: false, respectHeadOfficeConsent: false, referenceListId: null};
    expect(memberSendBlockReason(member({emailBlock: {reasonCode: "hardBounce"}, emailMarketingConsent: false} as Partial<Member>), noRules)).toBeNull();
  });

  it("lets committee members, social admins and walk admins use the email composer", () => {
    expect(emailComposerAllowed({committee: true} as MemberCookie)).toBe(true);
    expect(emailComposerAllowed({socialAdmin: true} as MemberCookie)).toBe(true);
    expect(emailComposerAllowed({walkAdmin: true} as MemberCookie)).toBe(true);
    expect(emailComposerAllowed({memberAdmin: true} as MemberCookie)).toBe(false);
    expect(emailComposerAllowed(null)).toBe(false);
  });
});
