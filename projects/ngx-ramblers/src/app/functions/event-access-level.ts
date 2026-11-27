import { AccessLevel, EventAccessContext } from "../models/member-resource.model";
import { accessLevelAllowed } from "./access-level";

export function eventAccessPermitted(accessLevel: AccessLevel | null | undefined, context: EventAccessContext): boolean {
  return accessLevelAllowed(accessLevel || AccessLevel.EVENT_ADMIN, {
    loggedIn: context.loggedIn,
    emailedAccess: false,
    committee: context.committee || context.eventAdmin,
    memberAdmin: context.memberAdmin || context.eventAdmin,
    environmentAdmin: context.memberAdmin || context.eventAdmin,
    eventAdmin: context.eventAdmin,
    eventLeader: context.eventLeader || context.eventAdmin
  });
}
