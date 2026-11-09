import crypto from "crypto";
import { isString } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";

export const RAMBLERS_UPLOAD_SIGNATURE_HEADER = "x-ramblers-upload-signature";

export type SignedJsonRequest = {
  header?(name: string): string | undefined;
  headers?: { [key: string]: string | string[] | undefined };
  body?: unknown;
};

function bytes(value: Buffer | Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function concatBytes(values: (Buffer | Uint8Array)[]): Uint8Array {
  const normalised = values.map(value => bytes(value));
  const totalLength = normalised.reduce((sum, value) => sum + value.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  normalised.forEach(value => {
    combined.set(value, offset);
    offset += value.byteLength;
  });
  return combined;
}

function derivedKey(secret: string): Uint8Array {
  return bytes(crypto.createHash("sha256").update(secret).digest());
}

export function encryptRamblersUploadPayload<T>(value: T, secret: string): string {
  const iv = bytes(crypto.randomBytes(12));
  const key = derivedKey(secret);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(value);
  const encrypted = concatBytes([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = bytes(cipher.getAuthTag());
  return Buffer.from(concatBytes([iv, authTag, encrypted])).toString("base64");
}

export function decryptRamblersUploadPayload<T>(encryptedValue: string, secret: string): T {
  const combined = Buffer.from(encryptedValue, "base64");
  const iv = bytes(combined.subarray(0, 12));
  const authTag = bytes(combined.subarray(12, 28));
  const ciphertext = bytes(combined.subarray(28));
  const key = derivedKey(secret);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.from(concatBytes([decipher.update(ciphertext), decipher.final()]));
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function signRamblersUploadBody(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyRamblersUploadSignature(body: string, secret: string, signature: string): boolean {
  const expectedSignature = signRamblersUploadBody(body, secret);

  if (!signature || expectedSignature.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    bytes(Buffer.from(expectedSignature, "utf8")),
    bytes(Buffer.from(signature, "utf8"))
  );
}

export function signedJsonHeaders(body: string, secret: string): Record<string, string> {
  return {
    "content-type": "application/json",
    [RAMBLERS_UPLOAD_SIGNATURE_HEADER]: signRamblersUploadBody(body, secret)
  };
}

function ramblersUploadSignatureHeader(req: SignedJsonRequest): string {
  const named = req.header ? req.header(RAMBLERS_UPLOAD_SIGNATURE_HEADER) : null;
  const raw = named || req.headers?.[RAMBLERS_UPLOAD_SIGNATURE_HEADER];
  if (isString(raw)) {
    return raw;
  } else {
    return "";
  }
}

export function verifySignedJsonRequest(
  req: SignedJsonRequest,
  secret: string | null | undefined = envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET)
): boolean {
  if (!secret) {
    return false;
  } else {
    return verifyRamblersUploadSignature(JSON.stringify(req.body ?? {}), secret, ramblersUploadSignatureHeader(req));
  }
}

export function signedJsonPost(url: string, secret: string, payload: object | string): Promise<Response> {
  const body = isString(payload) ? payload : JSON.stringify(payload);
  return fetch(url, {
    method: "POST",
    headers: signedJsonHeaders(body, secret),
    body
  });
}

export async function postSignedWorkerBody(url: string, sharedSecret: string, payload: object): Promise<void> {
  const response = await signedJsonPost(url, sharedSecret, payload);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Worker callback ${url} failed with status ${response.status}: ${text}`);
  } else {
    return;
  }
}
