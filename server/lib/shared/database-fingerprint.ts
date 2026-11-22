import { createHash } from "crypto";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { parseMongoUri } from "./mongodb-uri";

const FINGERPRINT_LENGTH = 16;

export function databaseFingerprint(cluster: string | null | undefined, database: string | null | undefined): string | null {
  return cluster && database
    ? createHash("sha256").update(`${cluster.replace(".mongodb.net", "")}/${database}`).digest("hex").slice(0, FINGERPRINT_LENGTH)
    : null;
}

export function runningDatabaseFingerprint(): string | null {
  const parsed = parseMongoUri((process.env[Environment.MONGODB_URI] || "").trim().replace(/^"|"$/g, ""));
  return databaseFingerprint(parsed?.cluster, parsed?.database);
}
