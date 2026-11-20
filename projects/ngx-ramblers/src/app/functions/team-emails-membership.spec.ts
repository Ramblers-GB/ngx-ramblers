import { describe, expect, it } from "vitest";
import { RamblersMember } from "../models/member.model";
import { fromTeamEmailsFeed, ignoredMember, teamEmailsIgnoredReason } from "./team-emails-membership";

function feedMember(memberStatus: string, salesforceTeamStatus: string): RamblersMember {
  return {memberStatus, salesforceTeamStatus} as RamblersMember;
}

describe("team-emails-membership", () => {
  it("keeps active and payment pending members of the group, as Insight Hub does", () => {
    expect(teamEmailsIgnoredReason(feedMember("Active", "Member"))).toBeNull();
    expect(teamEmailsIgnoredReason(feedMember("Payment pending", "Member"))).toBeNull();
  });

  it("keeps active affiliate members, as Insight Hub does", () => {
    expect(teamEmailsIgnoredReason(feedMember("Active", "Affiliated"))).toBeNull();
  });

  it("ignores suspended and lapsed members", () => {
    expect(teamEmailsIgnoredReason(feedMember("Suspended", "Member"))).toEqual("Membership suspended");
    expect(teamEmailsIgnoredReason(feedMember("Lapsed", "Volunteer"))).toEqual("Membership lapsed");
  });

  it("ignores an active volunteer who is not a member of the group", () => {
    expect(teamEmailsIgnoredReason(feedMember("Active", "Volunteer"))).toEqual("Team status volunteer, not a member of this group");
  });

  it("ignores a supporter with no membership status", () => {
    expect(teamEmailsIgnoredReason(feedMember(null, "Volunteer"))).toEqual("No membership status");
  });

  it("leaves Insight Hub uploads alone because they carry no team status", () => {
    const insightHubRow = {memberStatus: "Lapsed"} as RamblersMember;
    expect(fromTeamEmailsFeed(insightHubRow)).toBe(false);
    expect(teamEmailsIgnoredReason(insightHubRow)).toBeNull();
  });

  it("treats a member with a stored reason as ignored", () => {
    expect(ignoredMember({teamEmailsIgnoredReason: "Membership suspended"} as any)).toBe(true);
    expect(ignoredMember({} as any)).toBe(false);
  });
});
