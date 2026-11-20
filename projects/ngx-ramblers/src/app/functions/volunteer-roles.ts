import { countBy, isString, keys, uniq, values } from "es-toolkit/compat";
import { Member, VOLUNTEER_TEAM_STATUS } from "../models/member.model";
import { teamStatusOf } from "./team-emails-membership";
import {
  DEFAULT_VOLUNTEER_ROLE_CATEGORY_RULES,
  KNOWN_RAMBLERS_VOLUNTEER_ROLES,
  UNCATEGORISED_VOLUNTEER_ROLES_HEADING,
  VolunteerRoleCategory,
  VolunteerRoleCategoryRule,
  VolunteerRoleCount,
  VolunteerRoleGroup
} from "../models/system.model";
import {
  RIGHTS_OF_WAY_CONTACT_ROLE,
  RIGHTS_OF_WAY_CONTACTS_CATEGORY,
  RIGHTS_OF_WAY_VOLUNTEERS_CATEGORY,
  VolunteerRoleType
} from "../models/volunteer-management.model";
import { volunteerRoleLabel } from "./volunteer-management";

export function volunteerRolesFromText(roles: string): string[] {
  const text = isString(roles) && roles !== "[object Object]" ? roles : "";
  return text.split(",").map(role => role.trim()).filter(role => !!role);
}

export function volunteerRoleList(member: Member): string[] {
  return volunteerRolesFromText(member?.volunteerRoles);
}

export function combinedVolunteerRoles(first: string, second: string): string {
  const roles = uniq([...volunteerRolesFromText(first), ...volunteerRolesFromText(second)]);
  return roles.length > 0 ? roles.join(", ") : null;
}

export function volunteerWithoutRole(member: Member): boolean {
  return teamStatusOf(member) === VOLUNTEER_TEAM_STATUS && volunteerRoleList(member).length === 0;
}

export function volunteerRoleCounts(members: Member[]): VolunteerRoleCount[] {
  const counts = countBy(members.flatMap(member => uniq(volunteerRoleList(member))));
  return keys(counts).sort().map(role => ({role, memberCount: counts[role]}));
}

export function volunteerRoleCategoryFor(categories: VolunteerRoleCategory[], role: string): VolunteerRoleCategory {
  return (categories ?? []).find(category => category.roles?.includes(role));
}

export function assignVolunteerRoleCategory(categories: VolunteerRoleCategory[], role: string, categoryName: string): VolunteerRoleCategory[] {
  return categories.map(category => {
    const roles = (category.roles ?? []).filter(existing => existing !== role);
    return {...category, roles: category.name === categoryName ? [...roles, role].sort() : roles};
  });
}

export function volunteerRoleGroups(roles: string[], categories: VolunteerRoleCategory[]): VolunteerRoleGroup[] {
  const categorisedGroups: VolunteerRoleGroup[] = (categories ?? [])
    .map(category => ({heading: category.name, roles: roles.filter(role => category.roles?.includes(role)), categorised: true}))
    .filter(group => group.roles.length > 0);
  const uncategorisedRoles = roles.filter(role => !volunteerRoleCategoryFor(categories, role));
  const uncategorisedGroup: VolunteerRoleGroup[] = uncategorisedRoles.length > 0
    ? [{heading: UNCATEGORISED_VOLUNTEER_ROLES_HEADING, roles: uncategorisedRoles, categorised: false}]
    : [];
  return [...uncategorisedGroup, ...categorisedGroups];
}

export function rightsOfWayVolunteerRoles(): string[] {
  return values(VolunteerRoleType).map(roleType => volunteerRoleLabel(roleType));
}

export function defaultVolunteerRoleCategoryRules(): VolunteerRoleCategoryRule[] {
  return [
    {name: RIGHTS_OF_WAY_VOLUNTEERS_CATEGORY, roles: rightsOfWayVolunteerRoles(), keywords: []},
    {name: RIGHTS_OF_WAY_CONTACTS_CATEGORY, roles: [RIGHTS_OF_WAY_CONTACT_ROLE], keywords: []},
    ...DEFAULT_VOLUNTEER_ROLE_CATEGORY_RULES
  ];
}

export function knownVolunteerRoles(): string[] {
  return [...rightsOfWayVolunteerRoles(), RIGHTS_OF_WAY_CONTACT_ROLE, ...KNOWN_RAMBLERS_VOLUNTEER_ROLES];
}

export function defaultVolunteerRoleCategories(roles: string[]): VolunteerRoleCategory[] {
  const rules = defaultVolunteerRoleCategoryRules();
  const ruleFor = (role: string) => rules.find(rule => rule.roles?.includes(role))
    ?? rules.find(rule => rule.keywords.some(keyword => role.toLowerCase().includes(keyword)));
  return rules
    .map(rule => ({name: rule.name, roles: uniq(roles.filter(role => ruleFor(role) === rule)).sort()}))
    .filter(category => category.roles.length > 0);
}
