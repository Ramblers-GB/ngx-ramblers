import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { audienceRow, deliverabilityOptional, memberSelectionWindow, priorSendExclusionApplies, workflowRemovesRecipients } from "./email-composer-audience";
import { Member } from "../models/member.model";
import { MemberSelection, WorkflowAction } from "../models/mail.model";
import { DateRangeUnit, NO_DATE_FILTER } from "../models/search.model";
import { MemberSendBlockReason } from "../models/email-composer.model";

const today = DateTime.fromISO("2026-11-21T00:00:00", {zone: "Europe/London"});

describe("email-composer-audience", () => {
  it("works out the selection window from the notification settings", () => {
    expect(memberSelectionWindow(today, 1, DateRangeUnit.MONTHS).windowStart).toBe(today.minus({months: 1}).toMillis());
    expect(memberSelectionWindow(today, 3, NO_DATE_FILTER).noDateFilter).toBe(true);
  });

  it("describes one person in an audience with the reason they cannot be emailed", () => {
    const member = {id: "cat", firstName: "Cat", lastName: "Moor", email: "cat@example.com", emailMarketingConsent: false} as Member;
    expect(audienceRow(member, {respectEmailBlocks: true, respectHeadOfficeConsent: true, referenceListId: null}))
      .toEqual({memberId: "cat", name: "Cat Moor", email: "cat@example.com", unavailableReason: MemberSendBlockReason.NO_MARKETING_CONSENT});
  });

  it("treats delete and disable workflows as reaching members who cannot be emailed", () => {
    expect(workflowRemovesRecipients({postSendActions: [WorkflowAction.DISABLE_GROUP_MEMBER]})).toBe(true);
    expect(workflowRemovesRecipients({postSendActions: []})).toBe(false);
    expect(deliverabilityOptional(null, MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS)).toBe(true);
    expect(deliverabilityOptional(null, MemberSelection.RECENTLY_ADDED)).toBe(false);
  });

  it("leaves out people already sent an email only when its own filter is chosen", () => {
    const settings = {defaultMemberSelection: MemberSelection.RECENTLY_ADDED};
    expect(priorSendExclusionApplies(settings, MemberSelection.RECENTLY_ADDED)).toBe(true);
    expect(priorSendExclusionApplies(settings, MemberSelection.EXPIRED_MEMBERS)).toBe(false);
    expect(priorSendExclusionApplies(settings, null)).toBe(false);
  });
});
