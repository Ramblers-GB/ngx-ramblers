import { HasEmailFirstAndLastName, Member, RamblersMember } from "../models/member.model";

export function removeSpacesAndLower(value: string): string {
  return value ? value.replace(/[ ]/, "").trim().toLowerCase() : "";
}

export function removeCharactersNotPartOfName(value: string): string {
  return value ? value.replace(/\s+$/, "").replace(/\.$/, "").trim() : "";
}

export function createUserName(member: RamblersMember | Member): string {
  const firstName = removeCharactersNotPartOfName(removeSpacesAndLower(member?.firstName || member?.title));
  const lastName = removeCharactersNotPartOfName(removeSpacesAndLower(member?.lastName));
  if (firstName && lastName) {
    return `${firstName}.${lastName}`;
  } else if (firstName) {
    return firstName;
  } else if (lastName) {
    return lastName;
  } else {
    return "";
  }
}

export function createDisplayName(firstName: string, lastName: string): string {
  return (`${(firstName || "").trim()} ${(lastName || "").trim().substring(0, 1).toUpperCase()}`).trim();
}

export function createDisplayNameFromMember(member: HasEmailFirstAndLastName): string {
  return createDisplayName(member.firstName, member.lastName);
}

export function uniqueValueAgainst(value: string, taken: Set<string>, maxAttempts: number): string {
  const candidate = (attempt: number) => `${value}${attempt === 0 ? "" : attempt}`;
  const firstFree = (attempt: number): string => attempt >= maxAttempts
    ? candidate(maxAttempts)
    : taken.has(candidate(attempt)) ? firstFree(attempt + 1) : candidate(attempt);
  return firstFree(0);
}

export function createUniqueValueFrom(value: string, field: string, members: Member[]): string {
  return uniqueValueAgainst(value, new Set(members.map(member => member[field]).filter(existing => !!existing)), members.length + 1);
}

export function createUniqueUserName(member: RamblersMember | Member, members: Member[]): string {
  return createUniqueValueFrom(createUserName(member), "userName", members);
}

export function createUniqueDisplayName(member: HasEmailFirstAndLastName, members: Member[]): string {
  return createUniqueValueFrom(createDisplayNameFromMember(member), "displayName", members);
}
