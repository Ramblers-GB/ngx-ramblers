import expect from "expect";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import { emailedAccessFileIds, preserveEmailedAccessVersion } from "./committee-file-emailed-access";
import { restrictCommitteeFileQuery } from "./committee-file-controllers";
import * as config from "./config";
import committeeFile from "../models/committee-file";
import { envConfig } from "../../env-config/env-config";
import { CommitteeAttachmentPurpose, EMAILED_ACCESS_COOKIE } from "../../../../projects/ngx-ramblers/src/app/models/committee.model";
import { AccessLevel } from "../../../../projects/ngx-ramblers/src/app/models/member-resource.model";

const secret = "fictional-emailed-access-secret";
const fileId = "0123456789abcdef01234567";
const fileTypes = [
  {description: "Public papers", accessLevel: AccessLevel.PUBLIC},
  {description: "Member papers", accessLevel: AccessLevel.LOGGED_IN_MEMBER},
  {description: "Committee papers", accessLevel: AccessLevel.COMMITTEE}
];

function keyFor(committeeFileId: string, version = 0, purpose = CommitteeAttachmentPurpose.EMAILED_ACCESS, signingSecret = secret): string {
  return jwt.sign({purpose, committeeFileId, version}, signingSecret, {expiresIn: 3600});
}

function requestWithKeys(...keys: string[]): any {
  return {query: {}, headers: {cookie: `other=1; ${EMAILED_ACCESS_COOKIE}=${encodeURIComponent(keys.join("~"))}`}};
}

describe("Committee emailed access keys", () => {
  const sandbox = sinon.createSandbox();
  beforeEach(() => {
    sandbox.stub(envConfig, "auth").returns({secret} as any);
    sandbox.stub(config, "queryKey").resolves({value: {fileTypes}} as any);
  });
  afterEach(() => sandbox.restore());

  function storedFiles(files: object[]) {
    return sandbox.stub(committeeFile, "find").returns({lean: () => ({exec: () => Promise.resolve(files)})} as any);
  }

  it("opens the keyed document and member papers, but not committee papers", async () => {
    storedFiles([{_id: fileId, emailedAccessVersion: 0}]);
    const req = requestWithKeys(keyFor(fileId));
    await restrictCommitteeFileQuery(req, {setHeader: sandbox.spy()} as any, sandbox.spy());
    expect(JSON.parse(req.query.criteria).$and[1]).toEqual({$or: [
      {fileType: {$in: ["Public papers", "Member papers"]}},
      {_id: {$in: [fileId]}}
    ]});
  });

  it("ignores keys that were switched off, forged or issued for another purpose", async () => {
    storedFiles([{_id: fileId, emailedAccessVersion: 1}]);
    const req = requestWithKeys(keyFor(fileId, 0), keyFor(fileId, 1, CommitteeAttachmentPurpose.PREVIEW), keyFor(fileId, 1, CommitteeAttachmentPurpose.EMAILED_ACCESS, "someone-else"));
    expect(await emailedAccessFileIds(req)).toEqual([]);
  });

  it("leaves public visitors without a key exactly as before", async () => {
    const find = storedFiles([]);
    const req = {query: {}, headers: {}} as any;
    await restrictCommitteeFileQuery(req, {setHeader: sandbox.spy()} as any, sandbox.spy());
    expect(JSON.parse(req.query.criteria).$and[1]).toEqual({fileType: {$in: ["Public papers"]}});
    expect(find.called).toBe(false);
  });

  it("stops document saves from resetting a switched-off key version", () => {
    const req = {body: {id: fileId, fileType: "Member papers", emailedAccessVersion: 0}} as any;
    const next = sandbox.spy();
    preserveEmailedAccessVersion(req, {} as any, next);
    expect(req.body).toEqual({id: fileId, fileType: "Member papers"});
    expect(next.calledOnce).toBe(true);
  });
});
