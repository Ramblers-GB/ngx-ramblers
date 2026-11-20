import expect from "expect";
import { describe, it } from "mocha";
import { auditFor, bulkWriteFailures, needsWrite, writeOperation } from "./member-bulk-apply";
import { MemberApplyOutcome } from "../../../../projects/ngx-ramblers/src/app/models/member-bulk-apply.model";
import { Member, MemberAction } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { MailProvider } from "../../../../projects/ngx-ramblers/src/app/models/system.model";

function outcome(memberAction: MemberAction, memberMatch: MemberAction = MemberAction.found, member: Partial<Member> = {id: "64b000000000000000000001"}): MemberApplyOutcome {
  return {member: member as Member, memberMatch, memberAction, fieldChanges: [], changes: 0, notificationCandidates: []};
}

describe("member-bulk-apply", () => {
  describe("bulkWriteFailures", () => {
    it("reports validation failures that Mongoose leaves out of an unordered write that still succeeds", () => {
      const validationError = new Error("members validation failed: lastName: Path `lastName` is required.");
      const result = {mongoose: {results: [null, validationError, null]}};

      expect(bulkWriteFailures(3, result, null)).toEqual([null, "members validation failed: lastName: Path `lastName` is required.", null]);
    });

    it("maps database write errors back to the operation that failed", () => {
      const error = {writeErrors: [{index: 2, errmsg: "E11000 duplicate key error collection: members index: email_1"}]};

      expect(bulkWriteFailures(3, null, error)).toEqual([null, null, "E11000 duplicate key error collection: members index: email_1"]);
    });

    it("uses Mongoose's per-operation results when validation and write errors happen together", () => {
      const error = {
        writeErrors: [{index: 0, errmsg: "index of the valid operations only"}],
        mongoose: {results: [new Error("validation failed"), {errmsg: "E11000 duplicate key"}, null]}
      };

      expect(bulkWriteFailures(3, null, error)).toEqual(["validation failed", "E11000 duplicate key", null]);
    });

    it("rethrows an error that is not about individual operations", () => {
      const connectionLost = new Error("connection closed");

      expect(() => bulkWriteFailures(2, null, connectionLost)).toThrow("connection closed");
    });

    it("reports nothing when every operation succeeded", () => {
      expect(bulkWriteFailures(2, {}, null)).toEqual([null, null]);
    });
  });

  describe("needsWrite", () => {
    it("skips members with no changes", () => {
      expect(needsWrite(outcome(MemberAction.skipped), MailProvider.BREVO)).toBe(false);
    });

    it("writes updated and created members", () => {
      expect(needsWrite(outcome(MemberAction.updated), MailProvider.BREVO)).toBe(true);
      expect(needsWrite(outcome(MemberAction.created, MemberAction.created), MailProvider.NONE)).toBe(true);
    });

    it("writes unchanged members for Mailchimp so their update status is reset", () => {
      expect(needsWrite(outcome(MemberAction.skipped), MailProvider.MAILCHIMP)).toBe(true);
    });
  });

  describe("writeOperation", () => {
    it("inserts a created member under its planned id", () => {
      const operation = writeOperation({index: 0, created: true, memberId: "64b000000000000000000009", outcome: outcome(MemberAction.created, MemberAction.created, {firstName: "Ann"})}, 100, "admin");

      expect(operation.insertOne.document._id.toString()).toBe("64b000000000000000000009");
      expect(operation.insertOne.document).toMatchObject({firstName: "Ann", createdDate: 100, createdBy: "admin"});
    });

    it("updates an existing member without writing its id field", () => {
      const operation = writeOperation({index: 0, created: false, memberId: "64b000000000000000000001", outcome: outcome(MemberAction.updated)}, 100, "admin");

      expect(operation.updateOne.filter).toEqual({_id: "64b000000000000000000001"});
      expect(operation.updateOne.update.$set.id).toBeUndefined();
      expect(operation.updateOne.update.$set).toMatchObject({updatedDate: 100, updatedBy: "admin"});
    });
  });

  describe("auditFor", () => {
    it("records a failed creation as an error with no member id", () => {
      const audit = auditFor("session", outcome(MemberAction.created, MemberAction.created, {firstName: "Ann"}), 4, "64b000000000000000000009", "lastName is required", true, 100, "admin");

      expect(audit).toMatchObject({memberAction: MemberAction.error, memberId: null, rowNumber: 5});
      expect(audit.auditErrorMessage).toEqual({message: "Creation of member failed", error: "lastName is required"});
    });

    it("records a successful update against the member", () => {
      const audit = auditFor("session", outcome(MemberAction.updated), 0, "64b000000000000000000001", undefined, false, 100, "admin");

      expect(audit).toMatchObject({memberAction: MemberAction.updated, memberId: "64b000000000000000000001"});
      expect(audit.auditErrorMessage).toBeUndefined();
    });
  });
});
