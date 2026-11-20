import { describe, expect, it } from "vitest";
import { assignVolunteerRoleCategory, defaultVolunteerRoleCategories, knownVolunteerRoles, volunteerRoleCounts, volunteerRoleGroups, volunteerRoleList, volunteerWithoutRole } from "./volunteer-roles";
import { Member } from "../models/member.model";
import { UNCATEGORISED_VOLUNTEER_ROLES_HEADING, VolunteerRoleCategory } from "../models/system.model";

function member(volunteerRoles: string, salesforceTeamStatus = "Member"): Member {
  return {volunteerRoles, salesforceTeamStatus} as Member;
}

describe("volunteer-roles", () => {
  it("splits a member's comma separated roles and ignores blanks and stray objects", () => {
    expect(volunteerRoleList(member("Footpath Warden, Area Chair,"))).toEqual(["Footpath Warden", "Area Chair"]);
    expect(volunteerRoleList(member("[object Object]"))).toEqual([]);
    expect(volunteerRoleList({} as Member)).toEqual([]);
  });

  it("counts each member once per role", () => {
    expect(volunteerRoleCounts([member("Footpath Warden"), member("Footpath Warden, Footpath Warden"), member("Area Chair")]))
      .toEqual([{role: "Area Chair", memberCount: 1}, {role: "Footpath Warden", memberCount: 2}]);
  });

  it("treats a volunteer with no role as having no assigned role, but not an ordinary member", () => {
    expect(volunteerWithoutRole(member("", "Volunteer"))).toBe(true);
    expect(volunteerWithoutRole(member("Parish Footpath Observer", "Volunteer"))).toBe(false);
    expect(volunteerWithoutRole(member("", "Member"))).toBe(false);
  });

  it("moves a role from one category to another", () => {
    const categories: VolunteerRoleCategory[] = [{name: "Rights of way", roles: ["Footpath Warden"]}, {name: "Ramblers", roles: []}];
    expect(assignVolunteerRoleCategory(categories, "Footpath Warden", "Ramblers"))
      .toEqual([{name: "Rights of way", roles: []}, {name: "Ramblers", roles: ["Footpath Warden"]}]);
    expect(assignVolunteerRoleCategory(categories, "Footpath Warden", "")).toEqual([{name: "Rights of way", roles: []}, {name: "Ramblers", roles: []}]);
  });

  it("suggests default categories from role names, first matching rule wins", () => {
    expect(defaultVolunteerRoleCategories(["Area Treasurer", "Area Membership Secretary", "Web Editor", "Footpath Warden", "Walk Leader", "Area Solar Arrays Coordinator", "Something Else"])).toEqual([
      {name: "Footpaths and rights of way", roles: ["Footpath Warden"]},
      {name: "Walks", roles: ["Walk Leader"]},
      {name: "Membership", roles: ["Area Membership Secretary"]},
      {name: "Communications", roles: ["Web Editor"]},
      {name: "Environment", roles: ["Area Solar Arrays Coordinator"]},
      {name: "Committee", roles: ["Area Treasurer"]}
    ]);
  });

  it("puts the rights of way volunteer model roles in their own categories ahead of the keyword rules", () => {
    expect(defaultVolunteerRoleCategories(["Parish Footpath Observer", "Local Footpath Officer", "Group Coordinator", "Rights of Way Contact (organisation)", "Footpath Warden"])).toEqual([
      {name: "Rights of way volunteers", roles: ["Group Coordinator", "Local Footpath Officer", "Parish Footpath Observer"]},
      {name: "Rights of way contacts", roles: ["Rights of Way Contact (organisation)"]},
      {name: "Footpaths and rights of way", roles: ["Footpath Warden"]}
    ]);
  });

  it("knows every rights of way model role and every Ramblers role seen so far", () => {
    expect(knownVolunteerRoles()).toEqual(expect.arrayContaining(["Parish Footpath Observer", "Group Coordinator", "Rights of Way Contact (organisation)", "Area Chair", "Footpath Warden"]));
  });

  it("groups roles under their categories, with uncategorised roles first and empty categories left out", () => {
    const categories: VolunteerRoleCategory[] = [{name: "Rights of way", roles: ["Parish Footpath Observer"]}, {name: "Empty", roles: []}];
    expect(volunteerRoleGroups(["Area Chair", "Parish Footpath Observer"], categories)).toEqual([
      {heading: UNCATEGORISED_VOLUNTEER_ROLES_HEADING, roles: ["Area Chair"], categorised: false},
      {heading: "Rights of way", roles: ["Parish Footpath Observer"], categorised: true}
    ]);
  });
});
