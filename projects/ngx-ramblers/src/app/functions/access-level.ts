import { ACCESS_LEVEL_DEFINITIONS, AccessLevel, AccessLevelContext } from "../models/member-resource.model";
import { MemberCookie } from "../models/member.model";

export function accessLevelAllowed(level: AccessLevel, context: AccessLevelContext): boolean {
  return ACCESS_LEVEL_DEFINITIONS[level]?.permitted?.(context) ?? false;
}

export function accessLevelPermitted(level: AccessLevel, member: Partial<MemberCookie> | null, platformAdminEnabled = false, emailedAccess = false): boolean {
  return accessLevelAllowed(level, {
    loggedIn: !!member?.memberId,
    emailedAccess,
    committee: !!member?.committee,
    memberAdmin: !!member?.memberAdmin,
    environmentAdmin: platformAdminEnabled && !!member?.committee,
    eventAdmin: false,
    eventLeader: false
  });
}
