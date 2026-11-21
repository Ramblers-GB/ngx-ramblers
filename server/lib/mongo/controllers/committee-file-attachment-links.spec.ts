import expect from "expect";
import sinon from "sinon";
import jwt from "jsonwebtoken";
import { attachmentLink, requireAttachmentLink } from "./committee-file-attachment-links";
import { envConfig } from "../../env-config/env-config";
import { CommitteeAttachmentPurpose } from "../../../../projects/ngx-ramblers/src/app/models/committee.model";

const secret = "fictional-preview-secret";
const fileId = "0123456789abcdef01234567";

describe("Committee attachment preview links", () => {
  const sandbox = sinon.createSandbox();
  beforeEach(() => sandbox.stub(envConfig, "auth").returns({secret} as any));
  afterEach(() => sandbox.restore());

  it("issues a five-minute link scoped to one attachment", () => {
    const json = sandbox.spy();
    const setHeader = sandbox.spy();
    attachmentLink({params: {id: fileId}} as any, {json, setHeader} as any);
    const url = json.firstCall.args[0].response.url;
    const token = url.split("/").at(-1);
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    expect(payload.committeeFileId).toBe(fileId);
    expect(payload.purpose).toBe(CommitteeAttachmentPurpose.PREVIEW);
    expect(payload.exp - payload.iat).toBe(300);
    expect(setHeader.calledWith("Cache-Control", "private, no-store")).toBe(true);
    const next = sandbox.spy();
    requireAttachmentLink({params: {id: fileId, token}} as any, {} as any, next);
    expect(next.calledOnceWithExactly()).toBe(true);
  });

  it("rejects expired, malformed, differently scoped and unrelated tokens", () => {
    const tokens = [
      "invalid-token",
      jwt.sign({purpose: CommitteeAttachmentPurpose.PREVIEW, committeeFileId: fileId}, secret, {expiresIn: -1}),
      jwt.sign({purpose: CommitteeAttachmentPurpose.PREVIEW, committeeFileId: "another-file"}, secret),
      jwt.sign({memberId: "member-1"}, secret)
    ];
    tokens.forEach(token => {
      const next = sandbox.spy();
      const status = sandbox.stub().returns({json: sandbox.spy()});
      requireAttachmentLink({params: {id: fileId, token}} as any, {status} as any, next);
      expect(status.calledWith(404)).toBe(true);
      expect(next.called).toBe(false);
    });
  });
});
