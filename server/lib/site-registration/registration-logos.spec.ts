import expect from "expect";
import { describe, it } from "mocha";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { copyS3ObjectToBucket } from "./registration-logos";

describe("copyS3ObjectToBucket", () => {
  it("reads from the source client and writes with the destination client", async () => {
    const sent = {source: [], dest: []};
    const source = {
      bucket: "ngx-ramblers-demo-staging",
      client: {
        send: async command => {
          sent.source.push(command);
          return {Body: {transformToByteArray: async () => new Uint8Array([1, 2, 3])}, ContentType: "image/png"};
        }
      }
    };
    const dest = {
      bucket: "ngx-ramblers-craven-eu-west-2",
      client: {
        send: async command => {
          sent.dest.push(command);
          return {};
        }
      }
    };
    await copyS3ObjectToBucket(source as any, dest as any, "logos/group-horizontal-craven.png");
    expect(sent.source[0]).toBeInstanceOf(GetObjectCommand);
    expect(sent.source[0].input).toEqual({Bucket: "ngx-ramblers-demo-staging", Key: "logos/group-horizontal-craven.png"});
    expect(sent.dest[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent.dest[0].input.Bucket).toBe("ngx-ramblers-craven-eu-west-2");
    expect(sent.dest[0].input.Key).toBe("logos/group-horizontal-craven.png");
    expect(sent.dest[0].input.ContentType).toBe("image/png");
  });

  it("does not copy when source and destination buckets are the same", async () => {
    const source = {bucket: "same", client: {send: async () => { throw new Error("should not send"); }}};
    await copyS3ObjectToBucket(source as any, source as any, "logos/x.png");
  });
});
