import { configuredSiteLinks, siteUrlForEnvironment } from "./environment-site-url";

describe("siteUrlForEnvironment", () => {
  it("uses the site name under the shared domain", () => {
    expect(siteUrlForEnvironment("hillside", "ngx-ramblers-hillside", "example.org.uk")).toEqual("https://hillside.example.org.uk");
  });

  it("falls back to the Fly address when there is no shared domain", () => {
    expect(siteUrlForEnvironment("hillside", "ngx-ramblers-hillside", "")).toEqual("https://ngx-ramblers-hillside.fly.dev");
  });

  it("gives nothing when neither is known", () => {
    expect(siteUrlForEnvironment("", "", "")).toEqual("");
  });
});

describe("configuredSiteLinks", () => {
  const config = {
    cloudflare: {baseDomain: "example.org.uk"},
    environments: [{environment: "hillside", flyio: {appName: "ngx-ramblers-hillside"}}]
  } as any;

  it("links each named site, leaving unknown ones without an address", () => {
    expect(configuredSiteLinks(config, ["hillside", "missing"])).toEqual([
      {environment: "hillside", url: "https://hillside.example.org.uk"},
      {environment: "missing", url: ""}
    ]);
  });
});
