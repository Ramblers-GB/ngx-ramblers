const REDIRECT_PLACEHOLDER_IPV4 = "192.0.2.1";

const CLOUDFLARE_IPV6_PREFIXES = [
  "2606:4700:",
  "2400:cb00:",
  "2405:8100:",
  "2405:b500:",
  "2803:f800:",
  "2a06:98c0:"
];

export interface AddressRecord {
  type: string;
  content: string;
  proxied?: boolean;
  id?: string;
}

export function isCloudflareAnycastAddress(content: string): boolean {
  const value = (content || "").trim().toLowerCase();
  if (value.includes(":")) {
    return CLOUDFLARE_IPV6_PREFIXES.some(prefix => value.startsWith(prefix));
  } else {
    const octets = value.split(".").map(part => Number(part));
    if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet))) {
      return false;
    } else {
      const [a, b] = octets;
      return (a === 104 && b >= 16 && b <= 31)
        || (a === 172 && b >= 64 && b <= 71)
        || (a === 162 && b === 158)
        || (a === 198 && b === 41)
        || (a === 197 && b === 234)
        || (a === 188 && b === 114)
        || (a === 190 && b === 93)
        || (a === 108 && b === 162)
        || (a === 141 && b === 101)
        || (a === 173 && b === 245);
    }
  }
}

export function leftoverCloudflareAddressRecords(records: AddressRecord[]): AddressRecord[] {
  const addresses = records.filter(record => record.type === "A" || record.type === "AAAA")
    .filter(record => record.content !== REDIRECT_PLACEHOLDER_IPV4);
  const siteAddresses = addresses.filter(record => !isCloudflareAnycastAddress(record.content));
  const cloudflareAddresses = addresses.filter(record => isCloudflareAnycastAddress(record.content));
  if (siteAddresses.length > 0 && cloudflareAddresses.length > 0) {
    return cloudflareAddresses;
  } else {
    return [];
  }
}
