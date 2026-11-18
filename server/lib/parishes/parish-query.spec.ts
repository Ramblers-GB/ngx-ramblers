import expect from "expect";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import axios from "axios";
import { BSON } from "mongodb";
import { gzipSync } from "node:zlib";
import { Request, Response } from "express";
import { queryParishes } from "./parish-query";
import { parishBoundaryCache } from "../mongo/models/parish-boundary-cache";
import { dateTimeNowAsValue } from "../shared/dates";

const sandbox = sinon.createSandbox();

const boundaries: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [{type: "Feature", properties: {PARNCP24CD: "P001", PARNCP24NM: "Hillside Park"}, geometry: {type: "Polygon", coordinates: [[[0, 51], [0.1, 51], [0.1, 51.1], [0, 51]]]}}]
};

function response() {
  const res = {status: sandbox.stub().returnsThis(), json: sandbox.stub().returnsThis(), setHeader: sandbox.stub().returnsThis()};
  return res;
}

function request(west: string, extra = {}): Request {
  return {query: {west, south: "51", east: String(Number(west) + 0.2), north: "51.2", ...extra}} as unknown as Request;
}

function storedDocument(timestamp: number) {
  return BSON.deserialize(BSON.serialize({compressedData: gzipSync(JSON.stringify(boundaries)), timestamp}));
}

describe("parish boundary loading", () => {
  afterEach(() => sandbox.restore());

  it("rejects invalid, reversed, infinite and oversized bounds before accessing upstream services", async () => {
    const fetch = sandbox.stub(axios, "get");
    const read = sandbox.stub(parishBoundaryCache, "findOne");
    for (const req of [request("NaN"), request("Infinity"), request("0", {east: "-1"}), request("0", {north: "55"})]) {
      const res = response();
      await queryParishes(req, res as unknown as Response);
      expect(res.status.firstCall.args).toEqual([400]);
    }
    expect(fetch.called).toBe(false);
    expect(read.called).toBe(false);
  });

  it("serves persisted boundaries without downloading from ONS after a process restart", async () => {
    sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => storedDocument(dateTimeNowAsValue())} as any);
    const fetch = sandbox.stub(axios, "get");
    const res = response();
    await queryParishes(request("1"), res as unknown as Response);
    expect(fetch.called).toBe(false);
    expect(res.json.firstCall.args[0]).toEqual(boundaries);
    expect(res.setHeader.firstCall.args).toEqual(["Cache-Control", "public, max-age=86400"]);
  });

  it("shares concurrent nearby requests and persists the reduced geometry", async () => {
    const read = sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => null} as any);
    const write = sandbox.stub(parishBoundaryCache, "updateOne").returns({exec: async () => ({})} as any);
    const fetch = sandbox.stub(axios, "get").resolves({data: boundaries});
    const responses = [response(), response()];
    await Promise.all(responses.map((res, index) => queryParishes(request(index ? "2.012" : "2.011"), res as unknown as Response)));
    expect(fetch.callCount).toBe(1);
    expect(read.callCount).toBe(1);
    expect(write.callCount).toBe(1);
    expect(fetch.firstCall.args[1].params).toMatchObject({maxAllowableOffset: 0.00005, geometryPrecision: 5, geometry: "2,51,2.25,51.2"});
    expect(responses.map(res => res.json.firstCall.args[0])).toEqual([boundaries, boundaries]);
  });

  it("loads every upstream page before caching the result", async () => {
    sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => null} as any);
    const write = sandbox.stub(parishBoundaryCache, "updateOne").returns({exec: async () => ({})} as any);
    const fetch = sandbox.stub(axios, "get");
    fetch.onFirstCall().resolves({data: {...boundaries, exceededTransferLimit: true}});
    fetch.onSecondCall().resolves({data: boundaries});
    const res = response();
    await queryParishes(request("3"), res as unknown as Response);
    expect(fetch.secondCall.args[1].params.resultOffset).toBe(2000);
    expect(res.json.firstCall.args[0].features).toHaveLength(2);
    expect(write.calledOnce).toBe(true);
  });

  it("uses saved boundaries when an expired entry cannot be refreshed", async () => {
    sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => storedDocument(1)} as any);
    sandbox.stub(axios, "get").rejects(new Error("ONS unavailable"));
    const res = response();
    await queryParishes(request("4"), res as unknown as Response);
    expect(res.json.firstCall.args[0]).toEqual(boundaries);
    expect(res.status.called).toBe(false);
  });

  it("does not cache upstream error responses and allows a retry", async () => {
    sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => null} as any);
    const write = sandbox.stub(parishBoundaryCache, "updateOne").returns({exec: async () => ({})} as any);
    const fetch = sandbox.stub(axios, "get");
    fetch.onFirstCall().resolves({data: {error: {message: "Unavailable"}}});
    fetch.onSecondCall().resolves({data: boundaries});
    const failed = response();
    await queryParishes(request("5"), failed as unknown as Response);
    expect(failed.status.firstCall.args).toEqual([500]);
    expect(write.called).toBe(false);
    const retried = response();
    await queryParishes(request("5"), retried as unknown as Response);
    expect(retried.json.firstCall.args[0]).toEqual(boundaries);
    expect(fetch.callCount).toBe(2);
  });

  it("still serves boundaries when cache persistence fails", async () => {
    sandbox.stub(parishBoundaryCache, "findOne").returns({exec: async () => {throw new Error("Cache unavailable");}} as any);
    sandbox.stub(parishBoundaryCache, "updateOne").returns({exec: async () => {throw new Error("Cache unavailable");}} as any);
    sandbox.stub(axios, "get").resolves({data: boundaries});
    const res = response();
    await queryParishes(request("6"), res as unknown as Response);
    expect(res.json.firstCall.args[0]).toEqual(boundaries);
  });
});
