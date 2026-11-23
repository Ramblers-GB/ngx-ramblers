import { values } from "es-toolkit/compat";
import { OAuthWireParameter } from "../../../projects/ngx-ramblers/src/app/models/server.model";
import { SECRET_MASK } from "../../../projects/ngx-ramblers/src/app/models/config.model";

const MASKED_VALUE = "***";
const SECRET_QUERY_PARAMETER_PATTERN = new RegExp(`([?&](?:${values(OAuthWireParameter).join("|")})=)[^&#]*`, "gi");

export function maskOAuthWireParameters(text: string): string {
  return text ? text.replace(SECRET_QUERY_PARAMETER_PATTERN, `$1${MASKED_VALUE}`) : text;
}

export function maskedApiRequest<T extends Record<string, any>>(apiRequest: T): T {
  const path: string = apiRequest?.path;
  return path ? {...apiRequest, path: maskOAuthWireParameters(path)} : apiRequest;
}

export function secretOrSaved(secret: string, saved: string | null | undefined): string {
  return secret === SECRET_MASK ? saved || "" : secret;
}
