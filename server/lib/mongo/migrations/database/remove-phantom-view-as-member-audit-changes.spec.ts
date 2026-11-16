import { Db } from "mongodb";
import expect from "expect";
import { describe, it } from "mocha";
import sinon from "sinon";
import { PHANTOM_VIEW_AS_MEMBER_CHANGE, up } from "./20261116120000-remove-phantom-view-as-member-audit-changes";
import { MEMBER_UPDATE_AUDIT_COLLECTION } from "../shared/collection-names";

describe("remove phantom View As Member audit changes migration", () => {
  it("deletes rows that only record the phantom change, then removes it from rows that also record real changes", async () => {
    const deleteMany = sinon.stub().resolves({deletedCount: 1901});
    const updateMany = sinon.stub().resolves({modifiedCount: 15});
    const collection = sinon.stub();
    collection.withArgs(MEMBER_UPDATE_AUDIT_COLLECTION).returns({deleteMany, updateMany});
    await up({collection} as unknown as Db, null);
    expect(deleteMany.firstCall.args).toEqual([{fieldChanges: {$size: 1, $elemMatch: PHANTOM_VIEW_AS_MEMBER_CHANGE}}]);
    expect(updateMany.firstCall.args).toEqual([
      {fieldChanges: {$elemMatch: PHANTOM_VIEW_AS_MEMBER_CHANGE}},
      {$pull: {fieldChanges: PHANTOM_VIEW_AS_MEMBER_CHANGE}, $inc: {changes: -1}}
    ]);
    expect(deleteMany.calledBefore(updateMany)).toBe(true);
  });
});
