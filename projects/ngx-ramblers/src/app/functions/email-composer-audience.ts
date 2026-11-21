import { isNumber } from "es-toolkit/compat";
import { DateTime } from "luxon";
import { Member } from "../models/member.model";
import { MemberSelection, WorkflowAction } from "../models/mail.model";
import { DateRangeUnit, NO_DATE_FILTER } from "../models/search.model";
import {
  ComposerAudienceRow,
  ComposerFilterSelectionSettings,
  MemberSelectionWindow,
  MemberSendRules,
  RECIPIENT_PRE_FILTERS
} from "../models/email-composer.model";
import { memberSendBlockReason } from "./member-send-eligibility";
import { memberFullName } from "./member-names";

export function memberSelectionWindow(today: DateTime, amount: number | null | undefined, timeUnit: DateRangeUnit | string | null | undefined): MemberSelectionWindow {
  const unit = timeUnit ?? DateRangeUnit.MONTHS;
  const noDateFilter = unit === NO_DATE_FILTER;
  const months = isNumber(amount) ? amount : 1;
  return {
    noDateFilter,
    today: today.toMillis(),
    windowStart: noDateFilter ? 0 : today.minus({[unit]: months} as {[unit: string]: number}).toMillis()
  };
}

export function audienceRow(member: Member, rules: MemberSendRules): ComposerAudienceRow {
  return {
    memberId: member.id,
    name: memberFullName(member),
    email: member.email ?? "",
    unavailableReason: memberSendBlockReason(member, rules)
  };
}

export function workflowRemovesRecipients(settings: ComposerFilterSelectionSettings | null): boolean {
  const actions = settings?.postSendActions ?? [];
  return actions.includes(WorkflowAction.BULK_DELETE_GROUP_MEMBER) || actions.includes(WorkflowAction.DISABLE_GROUP_MEMBER);
}

export function deliverabilityOptional(settings: ComposerFilterSelectionSettings | null, preFilterKey: MemberSelection | null): boolean {
  return preFilterKey === MemberSelection.MISSING_FROM_BULK_LOAD_MEMBERS || workflowRemovesRecipients(settings);
}

export function priorSendExclusionApplies(settings: ComposerFilterSelectionSettings | null, preFilterKey: MemberSelection | null): boolean {
  const selection = settings?.defaultMemberSelection;
  return !!selection && preFilterKey === selection && RECIPIENT_PRE_FILTERS.some(filter => filter.key === selection);
}
