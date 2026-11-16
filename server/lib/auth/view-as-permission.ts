import { isBoolean, isUndefined } from "es-toolkit/compat";
import { Request } from "express";
import { Member, MemberCookie } from "../../../projects/ngx-ramblers/src/app/models/member.model";
import { member as memberModel } from "../mongo/models/member";
import { booleanOf } from "../shared/string-utils";

export function validateViewAsPermissionChange(actor: Partial<MemberCookie> | null, prior: Member | null, next: Member): void {
  if ((!isUndefined(next.viewAsMember) && next.viewAsMember !== null && !isBoolean(next.viewAsMember)) || (!isUndefined(next.memberAdmin) && next.memberAdmin !== null && !isBoolean(next.memberAdmin))) {
    throw Object.assign(new Error("View as permissions must be boolean values"), {status: 403});
  }
  const memberAdminChanges = !isUndefined(next.memberAdmin) && booleanOf(next.memberAdmin) !== booleanOf(prior?.memberAdmin);
  if (memberAdminChanges && !actor?.memberAdmin) {
    throw Object.assign(new Error("Member Admin permission is required to change administrator access"), {status: 403});
  }
  const permissionChanges = !isUndefined(next.viewAsMember) && booleanOf(next.viewAsMember) !== booleanOf(prior?.viewAsMember);
  const activatesExistingGrant = booleanOf(prior?.viewAsMember) && ((!booleanOf(prior.memberAdmin) && booleanOf(next.memberAdmin)) || (booleanOf(prior.revoked) && next.revoked === false));
  if ((permissionChanges || activatesExistingGrant) && !actor?.memberAdmin) {
    throw Object.assign(new Error("Only a member administrator can change the View as another member permission"), {status: 403});
  }
}

export async function validateViewAsPermissionChanges(req: Request, priorById: Map<string, Member>, members: Member[]): Promise<void> {
  const actorId = (req.user as Partial<MemberCookie>)?.memberId;
  const actor = actorId ? await memberModel.findById(actorId) : null;
  const currentActor = actor ? {memberId: actorId, memberAdmin: booleanOf(actor.memberAdmin) && !booleanOf(actor.revoked)} : null;
  members.forEach(next => validateViewAsPermissionChange(currentActor, priorById.get(next.id) ?? null, next));
}
