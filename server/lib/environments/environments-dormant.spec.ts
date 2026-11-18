import expect from "expect";
import { describe, it } from "mocha";
import { EnvironmentSiteStatus } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { assertEnvironmentNotDormant, environmentIsDormant } from "./environments-config";

describe("dormant environments keep their domains where they are", () => {
  it("treats a site marked Dormant as dormant", () => {
    expect(environmentIsDormant({environment: "hillside-park", siteStatus: EnvironmentSiteStatus.DORMANT})).toBe(true);
  });

  it("treats live, onboarding and unset sites as not dormant", () => {
    expect(environmentIsDormant({environment: "hillside-park", siteStatus: EnvironmentSiteStatus.LIVE})).toBe(false);
    expect(environmentIsDormant({environment: "hillside-park", siteStatus: EnvironmentSiteStatus.ONBOARDING})).toBe(false);
    expect(environmentIsDormant({environment: "hillside-park"})).toBe(false);
    expect(environmentIsDormant(null)).toBe(false);
  });

  it("refuses to attach a custom domain to a Dormant site and says how to bring it back", () => {
    expect(() => assertEnvironmentNotDormant({environment: "hillside-park", siteStatus: EnvironmentSiteStatus.DORMANT})).toThrow("Change its Site status first");
  });

  it("allows attaching a custom domain once the site is no longer Dormant", () => {
    expect(() => assertEnvironmentNotDormant({environment: "hillside-park", siteStatus: EnvironmentSiteStatus.LIVE})).not.toThrow();
  });
});
