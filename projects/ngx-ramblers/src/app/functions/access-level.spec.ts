import { accessLevelPermitted } from "./access-level";
import { AccessLevel, generalAccessLevels, ACCESS_LEVEL_DEFINITIONS, ACCESS_LEVEL_LABELS } from "../models/member-resource.model";
import { eventAccessPermitted } from "./event-access-level";

describe("Shared access-level definitions", () => {
  it("supplies labels and checks for every general access level from the same definition", () => {
    generalAccessLevels().forEach(level => {
      expect(ACCESS_LEVEL_LABELS[level]).toBe(ACCESS_LEVEL_DEFINITIONS[level].description);
      expect(ACCESS_LEVEL_DEFINITIONS[level].permitted).toBeTypeOf("function");
    });
  });

  it("denies unknown values, including inherited object property names", () => {
    ["unrecognised", "constructor", "toString"].forEach(value => {
      expect(accessLevelPermitted(value as AccessLevel, {memberId: "member-1", committee: true}, true)).toBe(false);
    });
  });

  it("keeps event administrator and organiser privileges scoped to event access", () => {
    const eventAdmin = {loggedIn: true, committee: false, memberAdmin: false, eventAdmin: true, eventLeader: false};
    expect(eventAccessPermitted(AccessLevel.COMMITTEE, eventAdmin)).toBe(true);
    expect(eventAccessPermitted(AccessLevel.MEMBER_ADMIN, eventAdmin)).toBe(true);
    expect(eventAccessPermitted(AccessLevel.ENVIRONMENT_ADMIN, eventAdmin)).toBe(true);
    expect(eventAccessPermitted(AccessLevel.EVENT_LEADER, eventAdmin)).toBe(true);
    expect(eventAccessPermitted(AccessLevel.HIDDEN, eventAdmin)).toBe(false);
    expect(accessLevelPermitted(AccessLevel.COMMITTEE, {memberId: "member-1", walkAdmin: true})).toBe(false);
    expect(accessLevelPermitted(AccessLevel.EVENT_ADMIN, {memberId: "member-1", walkAdmin: true})).toBe(false);
  });
});
