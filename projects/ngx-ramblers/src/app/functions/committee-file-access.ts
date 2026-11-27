import { CommitteeFileType } from "../models/committee.model";
import { AccessLevel } from "../models/member-resource.model";
import { MemberCookie } from "../models/member.model";
import { accessLevelPermitted } from "./access-level";

export function committeeFileAccessLevel(fileType: CommitteeFileType): AccessLevel {
  return fileType?.accessLevel ?? (fileType?.public ? AccessLevel.PUBLIC : AccessLevel.COMMITTEE);
}

export function committeeFileVisible(fileType: CommitteeFileType | null, member: Partial<MemberCookie> | null, platformAdminEnabled = false, emailedAccess = false): boolean {
  return !!member?.fileAdmin || accessLevelPermitted(committeeFileAccessLevel(fileType), member, platformAdminEnabled, emailedAccess);
}

export function mapCommitteeFileTypeAccessLevels(fileTypes: CommitteeFileType[]): CommitteeFileType[] {
  return (fileTypes || []).map(fileType => ({...fileType, accessLevel: committeeFileAccessLevel(fileType), meetingRole: fileType.meetingRole || null, meetingCategory: fileType.meetingCategory || null}));
}

export function committeeFileTypeComplete(fileType: CommitteeFileType): boolean {
  return !!fileType.description?.trim()
    && fileType.description.trim() !== "(Enter new file type)"
    && !!fileType.accessLevel
    && (!fileType.meetingRole || !!fileType.meetingCategory?.trim());
}
