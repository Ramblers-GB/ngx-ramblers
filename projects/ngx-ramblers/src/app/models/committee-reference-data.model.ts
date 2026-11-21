import { BuiltInRole, CommitteeFileType, CommitteeMember, ExpensesConfig } from "./committee.model";

export interface CommitteeReferenceDataLike {
  createFrom(injectedCommitteeMembers: CommitteeMember[]): CommitteeReferenceDataLike;
  committeeMembers(): CommitteeMember[];
  mailCommitteeMembers(): CommitteeMember[];
  loggedOnRole(): CommitteeMember;
  loggedOnRoles(): CommitteeMember[];
  committeeMemberForMember(memberId: string): CommitteeMember;
  fileTypes(): CommitteeFileType[];
  expensesConfig(): ExpensesConfig;
  committeeMembersForRole(role: string[] | string): CommitteeMember[];
  toRoles(role: string[] | string): string[];
  committeeMemberForRole(role: string): CommitteeMember;
  committeeMemberForBuiltInRole(builtInRole: BuiltInRole): CommitteeMember;
  contactUsField(role: BuiltInRole | string, field: string): string;
  contactUsFieldForBuiltInRole(role: BuiltInRole, field: string): string;
  memberId(role: string): string;
  email(role: string): string;
  description(role: string): string;
  fullName(role: string): string;
  isPublic(fileTypeDescription: string): boolean;
  isVisible(fileTypeDescription: string, platformAdminEnabled?: boolean): boolean;
}
