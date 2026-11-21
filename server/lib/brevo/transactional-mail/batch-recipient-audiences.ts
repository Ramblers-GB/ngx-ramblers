import { chunk, uniq, uniqBy } from "es-toolkit/compat";
import { BatchTransactionalSendRequest, ComposerAudienceDefinition, ComposerExternalRecipient } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { memberIdsForAudience } from "../../mongo/controllers/email-composer-audience";
import { member } from "../../mongo/models/member";
import { toObjectWithId } from "../../mongo/controllers/transforms";
import { composerRecipientFromMember } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer";
import { Member } from "../../../../projects/ngx-ramblers/src/app/models/member.model";

async function audienceIds(definitions: ComposerAudienceDefinition[]): Promise<string[]> {
  const batches = await Promise.all((definitions ?? []).map(definition => memberIdsForAudience(definition)));
  return uniq(batches.flat());
}

export async function memberRecordsForBatch(ids: string[], fields: Record<string, number> | null = null): Promise<Member[]> {
  return chunk(ids, 500).reduce(async (pending, batch) => {
    const people = await pending;
    const documents = fields ? await member.find({_id: {$in: batch}}, fields).lean() : await member.find({_id: {$in: batch}}).lean();
    return [...people, ...documents.map(toObjectWithId) as Member[]];
  }, Promise.resolve([] as Member[]));
}

async function headerRecipients(ids: string[]): Promise<ComposerExternalRecipient[]> {
  const people = await memberRecordsForBatch(ids, {firstName: 1, lastName: 1, displayName: 1, email: 1});
  const recipients = people.map(composerRecipientFromMember).filter((person): person is ComposerExternalRecipient => !!person);
  if (recipients.length !== ids.length) {
    throw new Error("Some Cc or Bcc recipients could not be resolved. Review the recipients before sending.");
  } else {
    return recipients;
  }
}

export async function resolveBatchRecipientAudiences(request: BatchTransactionalSendRequest): Promise<BatchTransactionalSendRequest> {
  if (request.audiences) {
    const [to, cc, bcc] = await Promise.all([
      audienceIds(request.audiences.to), audienceIds(request.audiences.cc), audienceIds(request.audiences.bcc)
    ]);
    const [ccRecipients, bccRecipients] = await Promise.all([headerRecipients(cc), headerRecipients(bcc)]);
    return {
      ...request,
      audiences: null,
      memberIds: uniq([...(request.memberIds ?? []), ...to]),
      ccRecipients: uniqBy([...(request.ccRecipients ?? []), ...ccRecipients], recipient => recipient.email.trim().toLowerCase()),
      bccRecipients: uniqBy([...(request.bccRecipients ?? []), ...bccRecipients], recipient => recipient.email.trim().toLowerCase())
    };
  } else {
    return request;
  }
}
