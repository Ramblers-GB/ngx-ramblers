import { describe, expect, it } from "vitest";
import { areaSite, siteMemberLabel } from "./site-membership";
import { SiteMemberLabel } from "../models/member.model";
import { SystemConfig } from "../models/system.model";

function config(groupCode: string, areaCode: string, groupCount: number): SystemConfig {
  return {
    group: {groupCode},
    area: {groupCode: areaCode, groups: Array.from({length: groupCount}, (_, index) => ({groupCode: `${areaCode}0${index + 1}`}))}
  } as unknown as SystemConfig;
}

describe("site-membership", () => {
  it("treats a site whose codes include its area code and that lists the area's groups as an area site", () => {
    expect(areaSite(config("KT", "KT", 3))).toBe(true);
    expect(siteMemberLabel(config("KT", "KT", 3))).toBe(SiteMemberLabel.AREA);
  });

  it("treats a group site as a group site", () => {
    expect(areaSite(config("KT14", "KT", 3))).toBe(false);
    expect(siteMemberLabel(config("KT14", "KT", 3))).toBe(SiteMemberLabel.GROUP);
  });

  it("uses the group label when the system config has not loaded", () => {
    expect(siteMemberLabel(null)).toBe(SiteMemberLabel.GROUP);
  });
});
