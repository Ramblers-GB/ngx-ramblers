import expect from "expect";
import sinon from "sinon";
import * as audiences from "../../mongo/controllers/email-composer-audience";
import { member } from "../../mongo/models/member";
import { resolveBatchRecipientAudiences } from "./batch-recipient-audiences";
import { BatchTransactionalSendRequest, ComposerAudienceScope, RecipientMode } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";

describe("batch recipient audience resolution", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());
  const definition = (listId: number) => ({scope: ComposerAudienceScope.MAILING_LIST, recipientMode: RecipientMode.SELECTED_MEMBERS, listId});
  const id = "64b000000000000000000001";

  it("resolves To, Cc and Bcc independently and removes duplicate copied addresses", async () => {
    sandbox.stub(audiences, "memberIdsForAudience").resolves([id]);
    sandbox.stub(member, "find").returns({lean: async () => [{_id: id, firstName: "Alex", lastName: "Reed", email: "alex@example.com"}]} as any);
    const request = {memberIds: [id], audiences: {to: [definition(1)], cc: [definition(2)], bcc: [definition(3)]}, ccRecipients: [{email: "ALEX@example.com"}]} as BatchTransactionalSendRequest;
    const resolved = await resolveBatchRecipientAudiences(request);
    expect(resolved.memberIds).toEqual([id]);
    expect(resolved.ccRecipients).toHaveLength(1);
    expect(resolved.bccRecipients).toEqual([{email: "alex@example.com", name: "Alex Reed", memberId: id, saveForReuse: false}]);
    expect(request.audiences).not.toBeNull();
    expect(resolved.audiences).toBeNull();
  });

  it("stops before delivery if a copied recipient cannot be resolved", async () => {
    sandbox.stub(audiences, "memberIdsForAudience").resolves([id]);
    sandbox.stub(member, "find").returns({lean: async () => []} as any);
    const request = {memberIds: [], audiences: {to: [], cc: [definition(2)], bcc: []}} as BatchTransactionalSendRequest;
    await expect(resolveBatchRecipientAudiences(request)).rejects.toThrow("Cc or Bcc recipients could not be resolved");
  });

  it("preserves existing requests without audience definitions", async () => {
    const lookup = sandbox.stub(audiences, "memberIdsForAudience");
    const request = {memberIds: [id]} as BatchTransactionalSendRequest;
    expect(await resolveBatchRecipientAudiences(request)).toBe(request);
    expect(lookup.called).toBe(false);
  });
});
