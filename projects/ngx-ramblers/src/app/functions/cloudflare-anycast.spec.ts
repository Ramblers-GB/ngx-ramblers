import { isCloudflareAnycastAddress, leftoverCloudflareAddressRecords } from "./cloudflare-anycast";

describe("cloudflare-anycast", () => {

  it("recognises Cloudflare IPv6 and IPv4 anycast", () => {
    expect(isCloudflareAnycastAddress("2606:4700:3036::ac43:b46d")).toBe(true);
    expect(isCloudflareAnycastAddress("104.21.18.56")).toBe(true);
    expect(isCloudflareAnycastAddress("2a09:8280:1::1f2:2add:0")).toBe(false);
    expect(isCloudflareAnycastAddress("66.241.125.141")).toBe(false);
  });

  it("returns leftover Cloudflare addresses when a Fly address is also present", () => {
    const leftovers = leftoverCloudflareAddressRecords([
      {type: "A", content: "66.241.125.141"},
      {type: "AAAA", content: "2a09:8280:1::1f2:2add:0"},
      {type: "AAAA", content: "2606:4700:3036::ac43:b46d"},
      {type: "AAAA", content: "2606:4700:3035::6815:1238"}
    ]);
    expect(leftovers.map(record => record.content)).toEqual([
      "2606:4700:3036::ac43:b46d",
      "2606:4700:3035::6815:1238"
    ]);
  });

  it("does not treat a redirect placeholder as a leftover", () => {
    expect(leftoverCloudflareAddressRecords([
      {type: "A", content: "192.0.2.1", proxied: true},
      {type: "AAAA", content: "2606:4700:3036::ac43:b46d"}
    ])).toEqual([]);
  });
});
