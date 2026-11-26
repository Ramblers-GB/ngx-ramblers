import { SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";

export function createApiRequestOptions(systemConfig: SystemConfig) {
  const ramblersUrl = new URL(systemConfig.national.walksManager.href);
  return {
    hostname: ramblersUrl.host,
    protocol: ramblersUrl.protocol,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  };
}
