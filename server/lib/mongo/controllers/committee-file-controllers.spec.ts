import expect from "expect";
import sinon from "sinon";
import { restrictCommitteeFileQuery, requireCommitteeFileView, requireCommitteeFileAdmin } from "./committee-file-controllers";
import * as config from "./config";
import committeeFile from "../models/committee-file";
import { AccessLevel } from "../../../../projects/ngx-ramblers/src/app/models/member-resource.model";

const fileTypes = [
  {description: "Public papers", public: true},
  {description: "Committee papers", accessLevel: AccessLevel.COMMITTEE},
  {description: "Member papers", accessLevel: AccessLevel.LOGGED_IN_MEMBER},
  {description: "Hidden papers", accessLevel: AccessLevel.HIDDEN}
];

describe("Committee file API permissions", () => {
  const sandbox = sinon.createSandbox();
  beforeEach(() => sandbox.stub(config, "queryKey").resolves({value: {fileTypes}} as any));
  afterEach(() => sandbox.restore());

  it("combines public access with caller criteria before selection or pagination", async () => {
    const req = {query: {criteria: JSON.stringify({eventDate: {$gte: 100}})}} as any;
    const res = {setHeader: sandbox.spy()} as any;
    const next = sandbox.spy();
    await restrictCommitteeFileQuery(req, res, next);
    expect(JSON.parse(req.query.criteria)).toEqual({$and: [{eventDate: {$gte: 100}}, {fileType: {$in: ["Public papers"]}}]});
    expect(next.calledOnceWithExactly()).toBe(true);
    expect(res.setHeader.calledWith("Cache-Control", "private, no-store")).toBe(true);
  });

  it("admits member documents but excludes committee and hidden documents for ordinary members", async () => {
    const req = {query: {}, user: {memberId: "member-1"}} as any;
    await restrictCommitteeFileQuery(req, {setHeader: sandbox.spy()} as any, sandbox.spy());
    expect(JSON.parse(req.query.criteria).$and[1].fileType.$in).toEqual(["Public papers", "Member papers"]);
  });

  it("lets committee members see documents whose file type is no longer configured", async () => {
    const req = {query: {}, user: {memberId: "member-1", committee: true}} as any;
    await restrictCommitteeFileQuery(req, {setHeader: sandbox.spy()} as any, sandbox.spy());
    expect(JSON.parse(req.query.criteria).$and[1]).toEqual({$or: [
      {fileType: {$in: ["Public papers", "Committee papers", "Member papers"]}},
      {fileType: {$nin: ["Public papers", "Committee papers", "Member papers", "Hidden papers"]}}
    ]});
  });

  it("does not let a known id bypass access checks", async () => {
    const exists = sandbox.stub(committeeFile, "exists").resolves(null);
    const json = sandbox.spy();
    const status = sandbox.stub().returns({json});
    const next = sandbox.spy();
    await requireCommitteeFileView({params: {id: "0123456789abcdef01234567"}} as any, {status, setHeader: sandbox.spy()} as any, next);
    expect(exists.firstCall.args[0]).toEqual({_id: "0123456789abcdef01234567", fileType: {$in: ["Public papers"]}});
    expect(status.calledWith(404)).toBe(true);
    expect(next.called).toBe(false);
  });

  it("lets file administrators manage hidden and unclassified records", async () => {
    const req = {query: {}, user: {memberId: "administrator", fileAdmin: true}} as any;
    await restrictCommitteeFileQuery(req, {setHeader: sandbox.spy()} as any, sandbox.spy());
    expect(JSON.parse(req.query.criteria)).toEqual({});
  });

  it("requires file administration for writes rather than login alone", () => {
    const next = sandbox.spy();
    const status = sandbox.stub().returns({json: sandbox.spy()});
    requireCommitteeFileAdmin({user: {memberId: "member-1", committee: true}} as any, {status} as any, next);
    expect(status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
    requireCommitteeFileAdmin({user: {memberId: "administrator", fileAdmin: true}} as any, {} as any, next);
    expect(next.calledOnce).toBe(true);
  });

  it("passes configuration failures to error handling without continuing", async () => {
    (config.queryKey as sinon.SinonStub).rejects(new Error("Config unavailable"));
    const next = sandbox.spy();
    await restrictCommitteeFileQuery({query: {}} as any, {setHeader: sandbox.spy()} as any, next);
    expect(next.firstCall.args[0].message).toBe("Config unavailable");
  });
});
