import { chunk, uniq, uniqBy } from "es-toolkit/compat";
import { BatchTransactionalSendRequest, ComposerAudienceDefinition, ComposerExternalRecipient, MemberSendRules } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";
import { memberIdsForAudience } from "../../mongo/controllers/email-composer-audience";
import { member } from "../../mongo/models/member";
import { toObjectWithId } from "../../mongo/controllers/transforms";
import { composerRecipientFromMember } from "../../../../projects/ngx-ramblers/src/app/functions/email-composer";
import { memberSendBlockReason } from "../../../../projects/ngx-ramblers/src/app/functions/member-send-eligibility";
import { Member } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { ConfigKey } from "../../../../projects/ngx-ramblers/src/app/models/config.model";
import { NotificationConfig } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import * as config from "../../mongo/controllers/config";
import { notificationConfig as notificationConfigModel } from "../../mongo/models/notification-config";

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

async function sendRulesForRequest(request: BatchTransactionalSendRequest): Promise<MemberSendRules> {
  const [brevoConfig, notificationConfig] = await Promise.all([
    config.queryKey(ConfigKey.BREVO),
    request.notificationConfigId
      ? notificationConfigModel.findById(request.notificationConfigId).lean().then((doc: any) => doc ? toObjectWithId(doc) as NotificationConfig : null)
      : Promise.resolve(null)
  ]);
  return {
    respectEmailBlocks: brevoConfig?.value?.respectEmailBlocks === true,
    respectHeadOfficeConsent: brevoConfig?.value?.respectHeadOfficeConsent !== false,
    referenceListId: request.narrowListId ?? notificationConfig?.defaultListId ?? null
  };
}

async function headerRecipients(ids: string[], rules: MemberSendRules): Promise<ComposerExternalRecipient[]> {
  const people = await memberRecordsForBatch(ids);
  const recipients = people.map(composerRecipientFromMember).filter((person): person is ComposerExternalRecipient => !!person);
  if (recipients.length !== ids.length) {
    throw new Error("Some Cc or Bcc recipients could not be resolved. Review the recipients before sending.");
  } else {
    const sendable = new Set(people.filter(person => !memberSendBlockReason(person, rules)).map(person => person.id));
    return recipients.filter(recipient => sendable.has(recipient.memberId));
  }
}

export async function resolveBatchRecipientAudiences(request: BatchTransactionalSendRequest): Promise<BatchTransactionalSendRequest> {
  if (request.audiences) {
    const [to, cc, bcc, rules] = await Promise.all([
      audienceIds(request.audiences.to), audienceIds(request.audiences.cc), audienceIds(request.audiences.bcc), sendRulesForRequest(request)
    ]);
    const [ccRecipients, bccRecipients] = await Promise.all([headerRecipients(cc, rules), headerRecipients(bcc, rules)]);
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
