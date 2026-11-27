import { decodedEmailedAccessKey, emailedAccessCookieValue, emailedAccessKeysFromCookieHeader, mergedEmailedAccessKeys, unexpiredEmailedAccessKeys } from "./emailed-access";
import { CommitteeAttachmentPurpose, EMAILED_ACCESS_COOKIE, EMAILED_ACCESS_MAX_KEYS } from "../models/committee.model";
import { accessLevelPermitted } from "./access-level";
import { AccessLevel } from "../models/member-resource.model";

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function keyFor(committeeFileId: string, exp = 2000, purpose = CommitteeAttachmentPurpose.EMAILED_ACCESS): string {
  return `${base64Url({alg: "HS256"})}.${base64Url({purpose, committeeFileId, version: 0, exp})}.signature`;
}

describe("Emailed document access keys", () => {
  it("reads keys back from the cookie they were written to", () => {
    const keys = [keyFor("file-1"), keyFor("file-2")];
    const header = `theme=dark; ${EMAILED_ACCESS_COOKIE}=${emailedAccessCookieValue(keys)}; other=1`;
    expect(emailedAccessKeysFromCookieHeader(header)).toEqual(keys);
    expect(emailedAccessKeysFromCookieHeader("theme=dark")).toEqual([]);
    expect(emailedAccessKeysFromCookieHeader(null)).toEqual([]);
  });

  it("only accepts emailed access keys that have not expired", () => {
    expect(decodedEmailedAccessKey(keyFor("file-1"))?.committeeFileId).toBe("file-1");
    expect(decodedEmailedAccessKey(keyFor("file-1", 2000, CommitteeAttachmentPurpose.PREVIEW))).toBeNull();
    expect(decodedEmailedAccessKey("not-a-key")).toBeNull();
    expect(unexpiredEmailedAccessKeys([keyFor("file-1", 999), keyFor("file-2", 1001)], 1000).map(entry => entry.payload.committeeFileId)).toEqual(["file-2"]);
  });

  it("keeps the newest key per document and caps how many are held", () => {
    const older = keyFor("file-1", 1500);
    const newer = keyFor("file-1", 2500);
    expect(mergedEmailedAccessKeys([older, keyFor("file-2")], newer, 1000)).toEqual([keyFor("file-2"), newer]);
    expect(mergedEmailedAccessKeys([], "rubbish", 1000)).toEqual([]);
    const many = Array.from({length: EMAILED_ACCESS_MAX_KEYS + 3}, (_, index) => keyFor(`file-${index}`));
    expect(mergedEmailedAccessKeys(many, keyFor("latest"), 1000).length).toBe(EMAILED_ACCESS_MAX_KEYS);
  });

  it("gives an emailed session member-level viewing without logging it in", () => {
    expect(accessLevelPermitted(AccessLevel.LOGGED_IN_MEMBER, null, false, true)).toBe(true);
    expect(accessLevelPermitted(AccessLevel.COMMITTEE, null, false, true)).toBe(false);
    expect(accessLevelPermitted(AccessLevel.NOT_LOGGED_IN, null, false, true)).toBe(true);
    expect(accessLevelPermitted(AccessLevel.LOGGED_IN_MEMBER, null, false, false)).toBe(false);
  });
});
