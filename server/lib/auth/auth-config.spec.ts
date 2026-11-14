import expect from "expect";
import sinon from "sinon";
import { Request, Response } from "express";
import { describe, it } from "mocha";
import { compareMemberPassword, compareValue, hashValue, requireMemberAdmin } from "./auth-config";

describe("compareValue", () => {
  it("returns false when the stored hash is missing", async () => {
    expect(await compareValue("secret", undefined as unknown as string)).toEqual(false);
  });

  it("returns false when the input password is missing", async () => {
    expect(await compareValue(undefined as unknown as string, await hashValue("secret"))).toEqual(false);
  });

  it("returns true for a matching bcrypt hash", async () => {
    expect(await compareValue("secret", await hashValue("secret"))).toEqual(true);
  });

  it("returns false for a non-matching bcrypt hash", async () => {
    expect(await compareValue("wrong", await hashValue("secret"))).toEqual(false);
  });
});

describe("compareMemberPassword", () => {
  it("rejects empty stored and supplied passwords", async () => {
    expect(await compareMemberPassword("", "")).toBe(false);
  });

  it("rejects a stored bcrypt hash supplied as the password", async () => {
    const stored = await hashValue("example-password");
    expect(await compareMemberPassword(stored, stored)).toBe(false);
    expect(await compareMemberPassword("example-password", stored)).toBe(true);
  });

  it("preserves existing non-empty plaintext credentials", async () => {
    expect(await compareMemberPassword("example-password", "example-password")).toBe(true);
  });
});

describe("requireMemberAdmin", () => {
  it("rejects members without member admin permission", () => {
    const json = sinon.stub();
    const status = sinon.stub().returns({json});
    const next = sinon.stub();
    requireMemberAdmin({user: {contentAdmin: true}} as unknown as Request, {status} as unknown as Response, next);
    expect(status.calledOnceWithExactly(403)).toBe(true);
    expect(next.called).toBe(false);
  });

  it("allows member administrators", () => {
    const next = sinon.stub();
    requireMemberAdmin({user: {memberAdmin: true}} as unknown as Request, {} as Response, next);
    expect(next.calledOnceWithExactly()).toBe(true);
  });
});
