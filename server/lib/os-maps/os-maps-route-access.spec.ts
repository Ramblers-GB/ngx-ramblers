import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { NextFunction, Request, Response } from "express";
import { MemberCookie } from "../../../projects/ngx-ramblers/src/app/models/member.model";
import { RouteVisibility } from "../../../projects/ngx-ramblers/src/app/models/os-maps-export.model";
import { OsMapsImportedRouteRecord } from "../mongo/models/os-maps-imported-route";
import * as mongooseClient from "../mongo/mongoose-client";
import * as routePages from "./os-maps-route-pages";
import * as routeWalks from "./os-maps-route-walks";
import { requireRouteFileAccess } from "./os-maps-route-access";

const record: OsMapsImportedRouteRecord = {routeId: "route-1", url: "https://group.example.org.uk/routes/1", importedAt: 1,
  ownerMemberId: "alex", visibility: RouteVisibility.GROUP, gpxFile: {awsFileName: "hillside-park.gpx"}};

function fileRequest(member: MemberCookie | null): Request {
  return {user: member, params: {bucket: "gpx-routes", 0: "/hillside-park.gpx"}} as unknown as Request;
}

function fileResponse() {
  const response = {status: sinon.stub(), json: sinon.stub(), locals: {}};
  response.status.returns(response);
  return response;
}

describe("route file access", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it("serves a group route's file to a visitor when a page shows it", async () => {
    sandbox.stub(mongooseClient, "execute").resolves(record);
    sandbox.stub(routePages, "pagesReferencingRoute").resolves([{path: "walks/routes/hillside-park"}]);
    sandbox.stub(routeWalks, "walkUsesGpxFile").resolves(false);
    const response = fileResponse();
    const next = sinon.stub();
    await requireRouteFileAccess(fileRequest(null), response as unknown as Response, next as unknown as NextFunction);
    expect(next.calledOnce).toBe(true);
    expect(response.status.called).toBe(false);
  });

  it("serves a group route's file to a visitor when a walk uses it", async () => {
    sandbox.stub(mongooseClient, "execute").resolves(record);
    sandbox.stub(routePages, "pagesReferencingRoute").resolves([]);
    sandbox.stub(routeWalks, "walkUsesGpxFile").resolves(true);
    const next = sinon.stub();
    await requireRouteFileAccess(fileRequest(null), fileResponse() as unknown as Response, next as unknown as NextFunction);
    expect(next.calledOnce).toBe(true);
  });

  it("keeps an unpublished group route's file from visitors", async () => {
    sandbox.stub(mongooseClient, "execute").resolves(record);
    sandbox.stub(routePages, "pagesReferencingRoute").resolves([]);
    sandbox.stub(routeWalks, "walkUsesGpxFile").resolves(false);
    const response = fileResponse();
    const next = sinon.stub();
    await requireRouteFileAccess(fileRequest(null), response as unknown as Response, next as unknown as NextFunction);
    expect(response.status.calledWith(404)).toBe(true);
    expect(next.called).toBe(false);
  });

  it("does not look up pages or walks for a member who can already see the route", async () => {
    sandbox.stub(mongooseClient, "execute").resolves(record);
    const pages = sandbox.stub(routePages, "pagesReferencingRoute").resolves([]);
    const next = sinon.stub();
    await requireRouteFileAccess(fileRequest({memberId: "robin"} as MemberCookie), fileResponse() as unknown as Response, next as unknown as NextFunction);
    expect(next.calledOnce).toBe(true);
    expect(pages.called).toBe(false);
  });
});
