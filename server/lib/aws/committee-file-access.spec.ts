import expect from "expect";
import sinon from "sinon";
import { requireCommitteeAttachmentAccess } from "./committee-file-access";
import committeeFile from "../mongo/models/committee-file";
import * as fileAccess from "../mongo/controllers/committee-file-controllers";

describe("Committee attachment permissions", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const visible = {fileType: {$in: ["Public papers"]}};

  const response = () => {
    const json = sandbox.spy();
    const res = {locals: {}, status: sandbox.stub().returns({json})};
    return res;
  };

  it("blocks a guessed private attachment URL", async () => {
    sandbox.stub(fileAccess, "visibleCommitteeFileCriteria").resolves(visible);
    sandbox.stub(committeeFile, "exists").resolves(null);
    const res = response();
    const next = sandbox.spy();
    await requireCommitteeAttachmentAccess({params: {bucket: "committeeFiles", 0: "/minutes.pdf"}} as any, res as any, next);
    expect(res.status.calledWith(404)).toBe(true);
    expect(next.called).toBe(false);
  });

  it("serves an attachment by its file name without searching document text", async () => {
    sandbox.stub(fileAccess, "visibleCommitteeFileCriteria").resolves(visible);
    const exists = sandbox.stub(committeeFile, "exists").resolves({_id: "file-1"} as any);
    const res = response();
    const next = sandbox.spy();
    await requireCommitteeAttachmentAccess({params: {bucket: "committeeFiles", 0: "/minutes.pdf"}} as any, res as any, next);
    expect(exists.calledOnce).toBe(true);
    expect(exists.firstCall.args[0]).toEqual({$and: [{"fileNameData.awsFileName": "minutes.pdf"}, visible]});
    expect(next.calledOnceWithExactly()).toBe(true);
    expect(res.locals).toEqual({privateCommitteeFile: true});
  });

  it("serves an image when any document showing it is visible, even if another showing it is not", async () => {
    sandbox.stub(fileAccess, "visibleCommitteeFileCriteria").resolves(visible);
    const exists = sandbox.stub(committeeFile, "exists");
    exists.onFirstCall().resolves(null);
    exists.onSecondCall().resolves({_id: "public-document"} as any);
    const next = sandbox.spy();
    await requireCommitteeAttachmentAccess({params: {bucket: "committeeFiles", 0: "/chart.png"}} as any, response() as any, next);
    expect(exists.secondCall.args[0]).toEqual({$and: [{"document.markdown": {$regex: "committeeFiles/chart\\.png"}}, visible]});
    expect(next.calledOnceWithExactly()).toBe(true);
  });

  it("allows file administrators to preview uploads before a document is saved", async () => {
    const exists = sandbox.stub(committeeFile, "exists");
    const next = sandbox.spy();
    await requireCommitteeAttachmentAccess({params: {bucket: "committeeFiles", 0: "/new.pdf"}, user: {fileAdmin: true}} as any, response() as any, next);
    expect(next.calledOnceWithExactly()).toBe(true);
    expect(exists.called).toBe(false);
  });

  it("leaves non-document assets on their existing route", async () => {
    const next = sandbox.spy();
    await requireCommitteeAttachmentAccess({params: {bucket: "carousels", 0: "/photo.jpg"}} as any, response() as any, next);
    expect(next.calledOnceWithExactly()).toBe(true);
  });
});
