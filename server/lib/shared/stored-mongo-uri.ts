import { EnvironmentConfig } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { ParsedMongoUri, parseMongoUri } from "./mongodb-uri";

export interface StoredMongoUri {
  present: boolean;
  parsed: ParsedMongoUri | null;
}

export function storedMongoUri(environmentConfig: EnvironmentConfig | null | undefined): StoredMongoUri {
  const storedUri = (environmentConfig?.secrets?.[Environment.MONGODB_URI] || "").trim().replace(/^"|"$/g, "");
  return {present: !!storedUri, parsed: parseMongoUri(storedUri)};
}
