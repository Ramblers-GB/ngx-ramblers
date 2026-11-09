import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { configuredEnvironments } from "../environments/environments-config";
import { deleteDnsRecord, listDnsRecords, zoneForHostname } from "../cloudflare/cloudflare-dns";
import { CloudflareDnsConfig, DnsRecordType } from "../cloudflare/cloudflare.model";
import { leftoverCloudflareAddressRecords } from "../../../projects/ngx-ramblers/src/app/functions/cloudflare-anycast";
import { loadEnvironmentContext } from "./environment-context";

const debugLog = debug(envConfig.logNamespace("environment-setup:remove-extra-dns"));

const ADDRESS_RECORD_TYPES = [DnsRecordType.A, DnsRecordType.AAAA];

export interface RemoveExtraDnsResult {
  hostname: string;
  removed: number;
  logs: string[];
}

export async function removeExtraCloudflareAddresses(environmentName: string, hostnameInput: string): Promise<RemoveExtraDnsResult> {
  const hostname = hostnameInput.trim().toLowerCase();
  const logs: string[] = [];
  await loadEnvironmentContext(environmentName);
  const environmentsConfig = await configuredEnvironments();
  const apiToken = environmentsConfig?.cloudflare?.apiToken;
  if (!apiToken) {
    throw new Error("Cloudflare API token not configured. Add cloudflare.apiToken to environments config.");
  } else {
    const zone = await zoneForHostname(apiToken, hostname);
    if (!zone) {
      throw new Error(`No Cloudflare zone covers ${hostname}`);
    } else {
      const dnsConfig: CloudflareDnsConfig = {apiToken, zoneId: zone.id};
      const records = (await listDnsRecords(dnsConfig, hostname))
        .filter(record => ADDRESS_RECORD_TYPES.includes(record.type as DnsRecordType));
      const leftovers = leftoverCloudflareAddressRecords(records);
      if (leftovers.length === 0) {
        logs.push(`  - ${hostname} has no extra Cloudflare addresses`);
        return {hostname, removed: 0, logs};
      } else {
        await leftovers.reduce(async (pending, leftover) => {
          await pending;
          if (leftover.id) {
            await deleteDnsRecord(dnsConfig, leftover.id);
            logs.push(`  ✓ Removed extra ${leftover.type} ${leftover.content} from ${hostname}`);
            debugLog("Removed extra %s %s from %s", leftover.type, leftover.content, hostname);
          }
        }, Promise.resolve());
        return {hostname, removed: leftovers.filter(record => !!record.id).length, logs};
      }
    }
  }
}
