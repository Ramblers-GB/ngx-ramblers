import { ListSetting } from "./mail.model";
import { Member, MemberAction, MemberAuditFieldChange } from "./member.model";
import { MemberSyncNotificationCandidate } from "./member-sync-notification.model";
import { MemberSyncPolicy } from "./member-sync-policy.model";
import { MailProvider } from "./system.model";

export interface MemberApplyDates {
  asValueNoTime(value: string | number, inputFormat?: string): number;
  displayDate(value: string | number): string;
  todayNoTime(): number;
  monthsAgoNoTime(months: number): number;
  now(): number;
}

export interface MemberApplyMailContext {
  mailProvider: MailProvider;
  respectHeadOfficeConsent: boolean;
  brevoListIds: number[];
  listSettings: ListSetting[];
  autoSubscribeNewMembers: boolean;
}

export interface MemberApplyContext {
  dates: MemberApplyDates;
  syncPolicy: MemberSyncPolicy;
  mail: MemberApplyMailContext;
}

export interface MemberApplyOutcome {
  member: Member;
  memberMatch: MemberAction;
  memberAction: MemberAction;
  fieldChanges: MemberAuditFieldChange[];
  changes: number;
  notificationCandidates: MemberSyncNotificationCandidate[];
}

export interface MemberBulkApplyRequest {
  uploadSessionId: string;
}

export interface MemberBulkApplyResult {
  uploadSessionId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

export interface MemberMatchKeys {
  salesforceId: string;
  membershipNumber: string;
  userName: string;
  firstOrTitle: string;
  firstName: string;
  lastName: string;
  title: string;
  nameAlias: string;
  email: string;
}

export interface MemberPlannedWrite {
  index: number;
  outcome: MemberApplyOutcome;
  memberId: string;
  created: boolean;
}
