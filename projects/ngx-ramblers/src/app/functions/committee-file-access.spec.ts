import { committeeFileAccessLevel, committeeFileTypeComplete, committeeFileVisible, mapCommitteeFileTypeAccessLevels } from "./committee-file-access";
import { CommitteeFileMeetingRole, CommitteeFileType } from "../models/committee.model";
import { AccessLevel } from "../models/member-resource.model";

const member = {memberId: "member-1"};
const committee = {...member, committee: true};
const administrator = {...member, fileAdmin: true};
const fileType = (accessLevel: AccessLevel): CommitteeFileType => ({description: "Meeting papers", accessLevel});

describe("Committee document access", () => {
  it("maps old file types without changing the stored object or replacing explicit access", () => {
    const oldTypes = [{description: "Public papers", public: true}, {description: "Private papers", public: false}, fileType(AccessLevel.MEMBER_ADMIN)];
    expect(mapCommitteeFileTypeAccessLevels(oldTypes).map(type => type.accessLevel)).toEqual([AccessLevel.PUBLIC, AccessLevel.COMMITTEE, AccessLevel.MEMBER_ADMIN]);
    expect(oldTypes[0].accessLevel).toBeUndefined();
    expect(committeeFileAccessLevel({description: "Unspecified"})).toBe(AccessLevel.COMMITTEE);
  });

  it("preserves legacy public and committee access including file administration", () => {
    expect(committeeFileVisible({description: "Public papers", public: true}, null)).toBe(true);
    expect(committeeFileVisible({description: "Private papers"}, member)).toBe(false);
    expect(committeeFileVisible({description: "Private papers"}, committee)).toBe(true);
    expect(committeeFileVisible({description: "Private papers"}, administrator)).toBe(true);
  });

  it("separates signed-in member access from committee and member administration", () => {
    expect(committeeFileVisible(fileType(AccessLevel.LOGGED_IN_MEMBER), member)).toBe(true);
    expect(committeeFileVisible(fileType(AccessLevel.LOGGED_IN_MEMBER), null)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.COMMITTEE), member)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.COMMITTEE), committee)).toBe(true);
    expect(committeeFileVisible(fileType(AccessLevel.MEMBER_ADMIN), committee)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.MEMBER_ADMIN), {...member, memberAdmin: true})).toBe(true);
  });

  it("requires a platform administrator for environment administration", () => {
    expect(committeeFileVisible(fileType(AccessLevel.ENVIRONMENT_ADMIN), committee, false)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.ENVIRONMENT_ADMIN), member, true)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.ENVIRONMENT_ADMIN), committee, true)).toBe(true);
  });

  it("keeps hidden, unknown and unsupported access closed while allowing file management", () => {
    expect(committeeFileVisible(fileType(AccessLevel.HIDDEN), committee)).toBe(false);
    expect(committeeFileVisible(fileType(AccessLevel.EVENT_ADMIN), member)).toBe(false);
    expect(committeeFileVisible(null, member)).toBe(false);
    expect(committeeFileVisible(null, committee)).toBe(true);
    expect(committeeFileVisible(fileType(AccessLevel.HIDDEN), administrator)).toBe(true);
  });

  it("lets an explicit access level override the old checkbox", () => {
    expect(committeeFileVisible({...fileType(AccessLevel.COMMITTEE), public: true}, null)).toBe(false);
    expect(committeeFileVisible({...fileType(AccessLevel.PUBLIC), public: false}, null)).toBe(true);
    expect(committeeFileVisible(fileType(AccessLevel.NOT_LOGGED_IN), null)).toBe(true);
    expect(committeeFileVisible(fileType(AccessLevel.NOT_LOGGED_IN), member)).toBe(false);
  });
  it("requires a completed description, access and meeting name before another row can be added", () => {
    expect(committeeFileTypeComplete({description: "", accessLevel: AccessLevel.COMMITTEE})).toBe(false);
    expect(committeeFileTypeComplete({description: "   ", accessLevel: AccessLevel.COMMITTEE})).toBe(false);
    expect(committeeFileTypeComplete({description: "(Enter new file type)", accessLevel: AccessLevel.COMMITTEE})).toBe(false);
    expect(committeeFileTypeComplete({description: "Reports"})).toBe(false);
    expect(committeeFileTypeComplete({description: "Reports", accessLevel: AccessLevel.COMMITTEE})).toBe(true);
    expect(committeeFileTypeComplete({...fileType(AccessLevel.PUBLIC), meetingRole: CommitteeFileMeetingRole.AGENDA})).toBe(false);
    expect(committeeFileTypeComplete({...fileType(AccessLevel.PUBLIC), meetingRole: CommitteeFileMeetingRole.MINUTES, meetingCategory: "AGM"})).toBe(true);
  });

});
