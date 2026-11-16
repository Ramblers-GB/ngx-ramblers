import { HEAD_OFFICE_SENDING_PERMISSION_FIELDS, Member } from "../../../projects/ngx-ramblers/src/app/models/member.model";
import { member } from "../mongo/models/member";
import { configuredSalesforce } from "./salesforce-config";
import { booleanOf } from "../shared/string-utils";

function missingAudiencePermission(sender: Member, recipients: Member[]): string | null {
  if (recipients.some(recipient => recipient.salesforceTeamStatus === "Member" || recipient.salesforceTeamStatus === "Affiliated")
    && !booleanOf(sender.canEmailMembers)) {
    return "Ramblers has not granted permission to email members";
  } else if (recipients.some(recipient => recipient.salesforceTeamStatus === "Volunteer")
    && !booleanOf(sender.canEmailVolunteers)) {
    return "Ramblers has not granted permission to email volunteers";
  } else if (recipients.some(recipient => recipient.salesforceTeamStatus === "Wellbeing Walker")
    && !booleanOf(sender.canEmailWellbeingWalkers)) {
    return "Ramblers has not granted permission to email Wellbeing Walkers";
  } else {
    return null;
  }
}

export function applyHeadOfficeSendingPermissionBounds(member: Member, prior: Member | undefined, teamEmailsEnabled: boolean): Member {
  if (teamEmailsEnabled) {
    HEAD_OFFICE_SENDING_PERMISSION_FIELDS.forEach(field => {
      member[field] = booleanOf(prior?.[field]);
    });
  }
  return member;
}

export function protectedEmailPermissionError(sender: Member | null, recipients: Member[]): string | null {
  const protectedRecipients = recipients.filter(recipient => !!recipient.salesforceMemberRef);
  if (protectedRecipients.length === 0) {
    return null;
  } else if (!sender?.salesforceMemberRef) {
    return "The signed-in account is not matched to a Ramblers supporter record";
  } else if (!booleanOf(sender.canViewMemberData)) {
    return "Ramblers has not granted permission to view supporter data";
  } else {
    return missingAudiencePermission(sender, protectedRecipients);
  }
}

export async function protectedEmailSendError(senderId: string | null, recipientIds: string[]): Promise<string | null> {
  const salesforceConfig = await configuredSalesforce();
  if (!salesforceConfig?.enabled || recipientIds.length === 0) {
    return null;
  } else {
    const [sender, recipients] = await Promise.all([
      senderId ? member.findById(senderId).lean().exec() as Promise<Member | null> : Promise.resolve(null),
      member.find({ _id: { $in: recipientIds } }).lean().exec() as Promise<Member[]>,
    ]);
    return protectedEmailPermissionError(sender, recipients);
  }
}
