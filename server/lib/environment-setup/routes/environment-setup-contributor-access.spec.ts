import expect from "expect";
import { Request, Response } from "express";
import { requireContributorBundleAccess } from "./environment-setup-controllers";

describe("requireContributorBundleAccess", () => {

  it("rejects a walk admin without member admin", () => {
    const progress = {next: 0, status: 0};
    const req = {user: {walkAdmin: true}, headers: {}} as unknown as Request;
    const res = {
      status(code: number) {
        progress.status = code;
        return {json() { return this; }};
      },
      json() {
        return this;
      }
    } as unknown as Response;
    requireContributorBundleAccess(req, res, () => {
      progress.next += 1;
    });
    expect(progress.next).toEqual(0);
    expect(progress.status).not.toEqual(0);
  });

  it("lets a site admin through without platform admin enabled", () => {
    const progress = {next: 0, status: 0};
    const req = {user: {memberAdmin: true}, headers: {}} as unknown as Request;
    const res = {
      status(code: number) {
        progress.status = code;
        return this;
      },
      json() {
        return this;
      }
    } as unknown as Response;
    requireContributorBundleAccess(req, res, () => {
      progress.next += 1;
    });
    expect(progress.next).toEqual(1);
    expect(progress.status).toEqual(0);
  });

});
