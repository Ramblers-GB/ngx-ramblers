import expect from "expect";
import { Request, Response } from "express";
import sinon from "sinon";
import { describe, it } from "mocha";
import { RouteFollowPoint } from "../../../projects/ngx-ramblers/src/app/models/route-follow.model";
import { chunked, heightsFromValhalla, routeHeights, routeHeightsHandler } from "./route-heights";

describe("route-heights", () => {

  it("keeps the heights Valhalla returns and blanks the ones it has no data for", () => {
    expect(heightsFromValhalla({height: [75, -32768, null, 55]}, 4)).toEqual([75, null, null, 55]);
  });

  it("returns a blank height for every point when Valhalla gives nothing back", () => {
    expect(heightsFromValhalla(null, 3)).toEqual([null, null, null]);
  });

  it("rejects invalid points instead of shifting heights onto different coordinates", async () => {
    const response = {status: sinon.stub().returnsThis(), json: sinon.spy()};
    await routeHeightsHandler({body: {points: [{latitude: 51, longitude: 0}, {latitude: 91, longitude: 0}]}} as Request, response as unknown as Response);
    expect(response.status.calledWith(400)).toBe(true);
    expect(response.json.calledOnce).toBe(true);
  });

  it("splits a long route into batches", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps heights in route order when batches are fetched one after another", async () => {
    const responses = [Array.from({length: 1000}, (_, index) => 10 + index), [30]];
    const calls = {count: 0};
    const fetchStub = sinon.stub(globalThis, "fetch").callsFake(async () => {
      const height = responses[calls.count++];
      return {ok: true, json: async () => ({height})} as unknown as Response;
    });
    try {
      const points = Array.from({length: 1001}, (_, index) => ({latitude: 51, longitude: index / 100000})) as RouteFollowPoint[];
      expect(await routeHeights(points)).toEqual([...responses[0], ...responses[1]]);
    } finally {
      fetchStub.restore();
    }
  });
});
