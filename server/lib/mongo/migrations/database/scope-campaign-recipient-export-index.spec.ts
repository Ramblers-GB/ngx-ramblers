import { Db } from "mongodb";
import expect from "expect";
import { describe, it } from "mocha";
import sinon from "sinon";
import { up } from "./20261116130000-scope-campaign-recipient-export-index";
import { CAMPAIGN_RECIPIENT_EXPORT_COLLECTION } from "../shared/collection-names";

function exportsCollection(legacyIndexExists: boolean) {
  return {
    createIndex: sinon.stub().resolves("accountKey_1_campaignId_1"),
    indexExists: sinon.stub().resolves(legacyIndexExists),
    dropIndex: sinon.stub().resolves({})
  };
}

describe("scope campaign recipient export index migration", () => {
  it("creates the account and campaign index before dropping the campaign-only index", async () => {
    const exports = exportsCollection(true);
    const collection = sinon.stub().withArgs(CAMPAIGN_RECIPIENT_EXPORT_COLLECTION).returns(exports);
    await up({collection} as unknown as Db, null);
    expect(exports.createIndex.firstCall.args).toEqual([{accountKey: 1, campaignId: 1}, {unique: true}]);
    expect(exports.indexExists.firstCall.args).toEqual(["campaignId_1"]);
    expect(exports.dropIndex.firstCall.args).toEqual(["campaignId_1"]);
    expect(exports.createIndex.calledBefore(exports.dropIndex)).toBe(true);
  });

  it("leaves indexes alone when the campaign-only index has already gone", async () => {
    const exports = exportsCollection(false);
    const collection = sinon.stub().withArgs(CAMPAIGN_RECIPIENT_EXPORT_COLLECTION).returns(exports);
    await up({collection} as unknown as Db, null);
    expect(exports.createIndex.calledOnce).toBe(true);
    expect(exports.dropIndex.called).toBe(false);
  });
});
