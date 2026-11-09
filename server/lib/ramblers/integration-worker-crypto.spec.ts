import expect from "expect";
import { describe, it } from "mocha";
import {
  decryptRamblersUploadPayload,
  encryptRamblersUploadPayload,
  RAMBLERS_UPLOAD_SIGNATURE_HEADER,
  signRamblersUploadBody,
  signedJsonHeaders,
  verifyRamblersUploadSignature,
  verifySignedJsonRequest
} from "./integration-worker-crypto";

describe("integrationWorkerCrypto", () => {
  it("encrypts and decrypts upload credentials", () => {
    const secret = "worker-secret";
    const credentials = {
      userName: "nick@example.com",
      password: "top-secret"
    };

    const encrypted = encryptRamblersUploadPayload(credentials, secret);
    const decrypted = decryptRamblersUploadPayload<typeof credentials>(encrypted, secret);

    expect(decrypted).toEqual(credentials);
  });

  it("signs and verifies request payloads", () => {
    const secret = "shared-secret";
    const body = JSON.stringify({ jobId: "job-123" });
    const signature = signRamblersUploadBody(body, secret);

    expect(verifyRamblersUploadSignature(body, secret, signature)).toEqual(true);
    expect(verifyRamblersUploadSignature(body, secret, `${signature}x`)).toEqual(false);
    expect(verifyRamblersUploadSignature(`${body}x`, secret, signature)).toEqual(false);
  });

  it("builds signed JSON headers from the body and secret", () => {
    const secret = "shared-secret";
    const body = JSON.stringify({jobId: "job-123"});
    const headers = signedJsonHeaders(body, secret);

    expect(headers["content-type"]).toEqual("application/json");
    expect(headers[RAMBLERS_UPLOAD_SIGNATURE_HEADER]).toEqual(signRamblersUploadBody(body, secret));
  });

  it("verifies a signed JSON request from the shared header", () => {
    const secret = "shared-secret";
    const payload = {jobId: "job-123"};
    const body = JSON.stringify(payload);
    const req = {
      header: (name: string) => name === RAMBLERS_UPLOAD_SIGNATURE_HEADER ? signRamblersUploadBody(body, secret) : undefined,
      body: payload
    };

    expect(verifySignedJsonRequest(req, secret)).toEqual(true);
    expect(verifySignedJsonRequest({...req, body: {jobId: "other"}}, secret)).toEqual(false);
    expect(verifySignedJsonRequest(req, "")).toEqual(false);
  });
});
