import expect from "expect";
import { describe, it } from "mocha";
import { RamblersMember } from "../../../projects/ngx-ramblers/src/app/models/member.model";
import { SalesforceMember } from "./salesforce.model";
import { areaGroupCodes, groupCodesByIdentityFrom, reconcileSupporterSnapshot } from "./salesforce-sync";
import { SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";

function existing(memberRef: string, overrides: Partial<RamblersMember> = {}): RamblersMember {
  return {
    salesforceMemberRef: memberRef,
    firstName: "Existing",
    postcode: "CT1 2AA",
    ...overrides,
  } as RamblersMember;
}

function supporter(memberRef: string, overrides: Partial<SalesforceMember> = {}): SalesforceMember {
  return {
    membershipNo: null,
    memberRef,
    contactId: `CONTACT-${memberRef}`,
    title: null,
    firstName: "Current",
    lastName: "Supporter",
    email: `${memberRef.toLowerCase()}@example.org`,
    doNotEmail: false,
    landline: null,
    mobile: null,
    friendlyName: "Current",
    membershipStatus: null,
    memberType: null,
    membershipJoinDate: null,
    membershipExpiry: null,
    membershipEndDate: null,
    teamStatus: "Volunteer",
    teamRelationshipFrom: null,
    wellbeingWalker: false,
    walkLeader: false,
    volunteerRoles: [],
    noWalkProgram: false,
    noCampaigning: false,
    noSurveys: false,
    canEmailVolunteers: false,
    canEmailMembers: false,
    canEmailWellbeingWalkers: false,
    canViewMemberData: false,
    canViewVolunteerData: false,
    emailConsent: true,
    emailConsentLastUpdated: null,
    postConsent: false,
    postConsentLastUpdated: null,
    phoneConsent: false,
    phoneConsentLastUpdated: null,
    emailConsentWellbeingWalks: false,
    ...overrides,
  };
}

describe("salesforce-sync supporter snapshot reconciliation", () => {
  it("preserves locally held fields missing from the API", () => {
    const result = reconcileSupporterSnapshot([existing("SUP-1")], [supporter("SUP-1")]);

    expect(result.members).toHaveLength(1);
    expect(result.members[0].postcode).toEqual("CT1 2AA");
    expect(result.members[0].firstName).toEqual("Current");
  });

  it("counts supporters that disappear from a later snapshot without preparing them for apply", () => {
    const result = reconcileSupporterSnapshot([existing("SUP-1")], []);

    expect(result.members).toHaveLength(0);
    expect(result.disappearedCount).toEqual(1);
  });

  it("keeps non-member supporters stable by memberRef", () => {
    const result = reconcileSupporterSnapshot(
      [existing("SUP-1", { membershipNumber: null })],
      [supporter("SUP-1", { membershipNo: null })],
    );

    expect(result.members).toHaveLength(1);
    expect(result.newCount).toEqual(0);
  });

  it("deduplicates the same supporter returned for more than one configured team", () => {
    const result = reconcileSupporterSnapshot([], [supporter("SUP-1"), supporter("SUP-1")]);

    expect(result.members).toHaveLength(1);
  });

  it("keeps group membership when the area returns the same supporter later as a volunteer", () => {
    const groupRecord = supporter("SUP-1", {teamStatus: "Member", volunteerRoles: [{roleName: "Walk Leader", startDate: "2024-01-01", displayName: null}]});
    const areaRecord = supporter("SUP-1", {teamStatus: "Volunteer", volunteerRoles: [{roleName: "Footpath Warden", startDate: "2024-01-01", displayName: null}]});
    const result = reconcileSupporterSnapshot([], [groupRecord, areaRecord]);

    expect(result.members).toHaveLength(1);
    expect(result.members[0].salesforceTeamStatus).toEqual("Member");
    expect(result.members[0].volunteerRoles).toEqual("Walk Leader, Footpath Warden");
  });
});

describe("salesforce-sync group codes for an area site", () => {
  const kentArea = {
    area: {groupCode: "KT", groups: [{groupCode: "KT06"}, {groupCode: "KT50"}]},
  } as unknown as SystemConfig;

  it("calls each group in the area when the site's team code is the area code", () => {
    expect(areaGroupCodes(kentArea, ["KT"])).toEqual(["KT06", "KT50"]);
  });

  it("does not call other groups for a group site", () => {
    expect(areaGroupCodes(kentArea, ["KT50"])).toEqual([]);
  });

  it("records every group a supporter appears in, including affiliates in more than one", () => {
    const byIdentity = groupCodesByIdentityFrom([
      {teamCode: "KT06", status: 200, supporters: [supporter("SUP-1"), supporter("SUP-2")]},
      {teamCode: "KT50", status: 200, supporters: [supporter("SUP-2")]},
    ]);

    const result = reconcileSupporterSnapshot([], [supporter("SUP-1"), supporter("SUP-2"), supporter("SUP-3")], byIdentity);

    expect(result.members.map(member => member.groupCodes)).toEqual([["KT06"], ["KT06", "KT50"], []]);
  });

  it("leaves group codes alone when they were not fetched", () => {
    const result = reconcileSupporterSnapshot([], [supporter("SUP-1")]);

    expect(result.members[0].groupCodes).toBeUndefined();
  });
});
