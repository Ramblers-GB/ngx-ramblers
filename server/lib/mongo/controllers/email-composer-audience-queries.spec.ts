import expect from "expect";
import sift from "sift";
import { values } from "es-toolkit/compat";
import { DateTime } from "luxon";
import { audienceQuery, filterSelectionQueries, listSubscriberQuery, memberSelectionQuery, sendBlockReasonQuery } from "./email-composer-audience-queries";
import { memberSelectionWindow } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer-audience";
import { memberSendBlockReason } from "../../../../projects/ngx-ramblers/src/app/functions/member-send-eligibility";
import { MemberSelection, WorkflowAction } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { ComposerAudienceDefinition, ComposerAudienceScope, MemberSendBlockReason, RecipientMode } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { Member, MemberTerm } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { NO_DATE_FILTER } from "../../../../projects/ngx-ramblers/src/app/models/search.model";

const today = DateTime.fromISO("2026-11-21T00:00:00", {zone: "Europe/London"});
const window = memberSelectionWindow(today, 1, "months");
const allTime = memberSelectionWindow(today, 0, NO_DATE_FILTER);
const recent = today.minus({days: 3}).toMillis();
const old = today.minus({months: 8}).toMillis();
const bulkLoadDateMap = {"M1": old, "M2": recent, "M3": recent};

function id(index: number): string {
  return `64b0000000000000000000${String(index).padStart(2, "0")}`;
}

function fixture(index: number, overrides: Partial<Member>): Member & {_id: string} {
  return {_id: id(index), id: id(index), firstName: `F${index}`, lastName: "Walker", email: `m${index}@example.com`, groupMember: true, mail: {subscriptions: [{id: 3, subscribed: true}]}, ...overrides} as Member & {_id: string};
}

const members = [
  fixture(1, {createdDate: recent}),
  fixture(2, {createdDate: recent, emailBlock: {reasonCode: "hardBounce"} as any}),
  fixture(3, {createdDate: recent, emailMarketingConsent: false}),
  fixture(4, {createdDate: recent, groupMember: false}),
  fixture(5, {createdDate: recent, email: ""}),
  fixture(6, {createdDate: old, mail: {subscriptions: [{id: 3, subscribed: false, unsubscribedAt: old}, {id: 4, subscribed: true}]} as any}),
  fixture(7, {createdDate: old, mail: {subscriptions: [{id: 3, subscribed: false, unsubscribedAt: old}]} as any}),
  fixture(8, {createdDate: old, updatedDate: old, membershipExpiryDate: today.minus({months: 3}).toMillis(), memberStatus: "Lapsed"}),
  fixture(9, {createdDate: old, membershipExpiryDate: today.minus({months: 3}).toMillis(), memberTerm: MemberTerm.LIFE}),
  fixture(10, {createdDate: old, membershipExpiryDate: today.minus({months: 3}).toMillis(), memberStatus: "Payment Pending"}),
  fixture(11, {createdDate: old, membershipNumber: "M1"}),
  fixture(12, {createdDate: recent, membershipNumber: "M2"}),
  fixture(13, {createdDate: old, membershipNumber: "M3", mail: {subscriptions: []} as any})
];

function matching(query: object): number[] {
  return members.filter(sift(query as any)).map(item => Number(item.id.slice(-2)));
}

const strictRules = {respectEmailBlocks: true, respectHeadOfficeConsent: true, referenceListId: null};

describe("email composer audience queries", () => {
  it("find recently added, expired and bulk load members", () => {
    expect(matching(memberSelectionQuery(MemberSelection.RECENTLY_ADDED, window, bulkLoadDateMap))).toEqual([1, 2, 3, 5, 12]);
    expect(matching(memberSelectionQuery(MemberSelection.RECENTLY_ADDED, allTime, bulkLoadDateMap))).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(matching(memberSelectionQuery(MemberSelection.EXPIRED_MEMBERS, window, bulkLoadDateMap))).toEqual([8]);
    expect(matching(memberSelectionQuery(MemberSelection.EXPIRED_MEMBERS, allTime, bulkLoadDateMap))).toEqual([8]);
    expect(matching(memberSelectionQuery(MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS, window, bulkLoadDateMap))).toEqual([11]);
    expect(matching(memberSelectionQuery(MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS, allTime, bulkLoadDateMap))).toEqual([11, 12, 13]);
    expect(matching(memberSelectionQuery(MemberSelection.ADDED_IN_LAST_BULK_LOAD_MEMBERS, window, bulkLoadDateMap))).toEqual([12]);
    expect(matching(memberSelectionQuery(MemberSelection.ADDED_IN_LAST_BULK_LOAD_MEMBERS, window, {}))).toEqual([]);
  });

  it("find group members with an email address who are subscribed to a list", () => {
    expect(matching(listSubscriberQuery(3))).toEqual([1, 2, 3, 8, 9, 10, 11, 12]);
    expect(matching(listSubscriberQuery(4))).toEqual([6]);
    expect(matching(listSubscriberQuery(5))).toEqual([]);
  });

  it("give each person the same reason they cannot be emailed as the rules the send uses", () => {
    [null, 3, 4].flatMap(referenceListId => [
      {respectEmailBlocks: true, respectHeadOfficeConsent: true, referenceListId},
      {respectEmailBlocks: true, respectHeadOfficeConsent: false, referenceListId},
      {respectEmailBlocks: false, respectHeadOfficeConsent: true, referenceListId}
    ]).forEach(rules => values(MemberSendBlockReason).forEach(reason => {
      expect(matching(sendBlockReasonQuery(reason, rules)))
        .toEqual(members.filter(item => memberSendBlockReason(item, rules) === reason).map(item => Number(item.id.slice(-2))));
    }));
  });

  it("build each kind of audience", () => {
    const audience = (shape: Partial<ComposerAudienceDefinition>) => matching(audienceQuery({scope: ComposerAudienceScope.EVERYONE, recipientMode: RecipientMode.SELECTED_MEMBERS, ...shape}, window, bulkLoadDateMap));
    expect(audience({})).toEqual([1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(audience({scope: ComposerAudienceScope.MAILING_LIST, listId: 3})).toEqual([1, 2, 3, 8, 9, 10, 11, 12]);
    expect(audience({scope: ComposerAudienceScope.MEMBER_FILTER, preFilterKey: MemberSelection.RECENTLY_ADDED})).toEqual([1, 2, 3, 12]);
    expect(audience({scope: ComposerAudienceScope.MEMBER_FILTER, narrowListId: 4})).toEqual([6]);
    expect(audience({scope: ComposerAudienceScope.NAMED_MEMBERS, memberIds: [id(4), id(5), "not-an-id"]})).toEqual([4, 5]);
    expect(audience({memberIds: [id(4), id(5)], excludedMemberIds: [id(1)]})).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("select members for a filter, applying the send rules unless the email removes or disables its recipients", () => {
    const selection = (preFilterKey: MemberSelection | null, settings: object | null, narrowListId: number | null = null) => {
      const queries = filterSelectionQueries({recipientMode: RecipientMode.SELECTED_MEMBERS, preFilterKey, narrowListId}, settings, strictRules, window, bulkLoadDateMap);
      return {candidates: matching(queries.candidates), available: matching(queries.available), matching: matching(queries.matching)};
    };
    expect(selection(MemberSelection.RECENTLY_ADDED, null)).toEqual({candidates: [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13], available: [1, 6, 8, 9, 10, 11, 12, 13], matching: [1, 12]});
    expect(selection(MemberSelection.RECENTLY_ADDED, {postSendActions: [WorkflowAction.DISABLE_GROUP_MEMBER]}).matching).toEqual([1, 2, 3, 5, 12]);
    expect(selection(MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS, null).matching).toEqual([11]);
    expect(selection(null, null, 3)).toEqual({candidates: [1, 2, 3, 8, 9, 10, 11, 12], available: [1, 8, 9, 10, 11, 12], matching: [1, 8, 9, 10, 11, 12]});
  });
});
