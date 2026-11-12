import expect from "expect";
import { describe, it } from "mocha";
import { pickAwsConfigForBucket, s3RegionFromError, s3RegionFromLocationConstraint } from "./aws-setup";

describe("s3RegionFromLocationConstraint", () => {
  it("maps an empty constraint to us-east-1", () => {
    expect(s3RegionFromLocationConstraint(undefined)).toBe("us-east-1");
  });

  it("maps the legacy EU constraint to eu-west-1", () => {
    expect(s3RegionFromLocationConstraint("EU")).toBe("eu-west-1");
  });

  it("keeps a named region", () => {
    expect(s3RegionFromLocationConstraint("eu-west-2")).toBe("eu-west-2");
  });
});

describe("s3RegionFromError", () => {
  it("reads x-amz-bucket-region from a PermanentRedirect response", () => {
    expect(s3RegionFromError({
      $response: {headers: {"x-amz-bucket-region": "eu-west-1"}}
    })).toBe("eu-west-1");
  });

  it("returns null when the header is missing", () => {
    expect(s3RegionFromError({$response: {headers: {}}})).toBe(null);
  });
});

describe("pickAwsConfigForBucket", () => {
  const running = {bucket: "running-bucket", region: "eu-west-1", accessKeyId: "RUN", secretAccessKey: "run-secret"};
  const hillside = {bucket: "ngx-ramblers-hillside-eu-west-2", region: "eu-west-2", accessKeyId: "HILL", secretAccessKey: "hill-secret"};

  it("uses the estate entry whose bucket matches", () => {
    expect(pickAwsConfigForBucket([{aws: hillside}], running, hillside.bucket)).toEqual(hillside);
  });

  it("falls back to the running process credentials when they own the bucket", () => {
    expect(pickAwsConfigForBucket([], running, "running-bucket")).toEqual(running);
  });

  it("returns null when no credentials own the bucket", () => {
    expect(pickAwsConfigForBucket([{aws: hillside}], running, "ngx-ramblers-demo-staging")).toBe(null);
  });
});
