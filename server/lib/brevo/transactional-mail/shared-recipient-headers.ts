import { BatchTransactionalSendRequest, SharedRecipientHeaderOptions, SharedRecipientHeaders } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { CommitteeMember, roleEmailAddresses } from "../../../../projects/ngx-ramblers/src/app/models/committee.model";
import { batchSendRecipientSplit, composerAudienceIncludesMailingListOrFilter, composerMailAllowsSharedRecipientHeaders } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer";
import { normaliseEmail } from "../../../../projects/ngx-ramblers/src/app/functions/strings";
import { member } from "../../mongo/models/member";

export async function batchSharesRecipientHeaders(request: BatchTransactionalSendRequest, personalised: boolean, roles: CommitteeMember[]): Promise<boolean> {
  if (request.sharedToRecipients !== true || !composerMailAllowsSharedRecipientHeaders(request.brandingMode, personalised)) {
    return false;
  } else if (!composerAudienceIncludesMailingListOrFilter(request) && !request.memberIds?.length) {
    return true;
  } else {
    const recipients = [...(request.externalRecipients ?? []), ...(request.ccRecipients ?? []), ...(request.bccRecipients ?? [])]
      .filter(recipient => !!recipient?.email?.trim());
    const memberIds = [...(request.memberIds ?? []), ...batchSendRecipientSplit(recipients).memberIds];
    const committee = await member.find({committee: true}, {_id: 1, email: 1}).lean();
    const committeeIds = new Set(committee.map(person => String(person._id)));
    const committeeEmails = new Set([
      ...committee.map(person => normaliseEmail(person.email)),
      ...roles.flatMap(role => roleEmailAddresses(role)).map(normaliseEmail)
    ].filter(Boolean));
    return memberIds.every(id => committeeIds.has(id))
      && recipients.every(recipient => committeeEmails.has(normaliseEmail(recipient.email)));
  }
}

export function sharedRecipientHeaders(options: SharedRecipientHeaderOptions): SharedRecipientHeaders {
  if (options.memberRecipientsAsBcc) {
    return {
      to: options.externalToRecipients,
      bcc: [...options.existingBccRecipients, ...options.memberRecipients]
    };
  } else {
    return {
      to: [...options.memberRecipients, ...options.externalToRecipients],
      bcc: options.existingBccRecipients
    };
  }
}
