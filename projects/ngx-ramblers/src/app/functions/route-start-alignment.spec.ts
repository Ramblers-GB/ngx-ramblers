import { describe, expect, it } from "vitest";
import { RouteFollowPoint, RouteStartAlignmentKind } from "../models/route-follow.model";
import { routeStartAdjustable, routeStartAlignment, routeStartAlignmentMessage, routeStartNeedsAttention, walkStartPoint } from "./route-start-alignment";
import { loopRestartedAt, metresBetween } from "./route-geometry";

const origin = {latitude: 51.26, longitude: 0.93};

function offset(northMetres: number, eastMetres: number): RouteFollowPoint {
  return {
    latitude: origin.latitude + northMetres / 111320,
    longitude: origin.longitude + eastMetres / (111320 * Math.cos(origin.latitude * Math.PI / 180))
  };
}

const loop = [offset(0, 0), offset(1000, 0), offset(1000, 1000), offset(0, 1000), offset(0, 0)];
const linear = [offset(0, 0), offset(1000, 0), offset(1000, 1000)];
const metres = (value: number) => `${Math.round(value / 100) / 10} km`;

describe("route start alignment", () => {
  it("accepts a route that starts within 50 m of the walk's start", () => {
    const alignment = routeStartAlignment(loop, offset(40, 0));
    expect(alignment.kind).toBe(RouteStartAlignmentKind.ALIGNED);
    expect(routeStartNeedsAttention(alignment)).toBe(false);
  });

  it("flags a route that starts 60 m away", () => {
    expect(routeStartAlignment(linear, offset(60, 20)).kind).not.toBe(RouteStartAlignmentKind.ALIGNED);
  });

  it("finds where a circular route passes a start that sits just off the path, and restarts the loop there", () => {
    const alignment = routeStartAlignment(loop, offset(1048, 500));
    expect(alignment.kind).toBe(RouteStartAlignmentKind.LOOP_PASSES_START);
    expect(routeStartAdjustable(alignment)).toBe(true);
    expect(Math.abs(alignment.passesAtMetres - 1500)).toBeLessThan(5);
    const restarted = loopRestartedAt(loop, alignment.startPoint);
    expect(metresBetween(restarted[0], offset(1000, 500))).toBeLessThan(5);
    expect(metresBetween(restarted.at(-1), restarted[0])).toBe(0);
    expect(routeStartAlignment(restarted, offset(1048, 500)).kind).toBe(RouteStartAlignmentKind.ALIGNED);
  });

  it("treats a route as starting at the walk's start once it starts at its nearest point to it, even 90 m away", () => {
    const pubBehindHedge = offset(1090, 500);
    const restarted = loopRestartedAt(loop, routeStartAlignment(loop, pubBehindHedge).startPoint);
    expect(metresBetween(restarted[0], pubBehindHedge)).toBeGreaterThan(80);
    expect(routeStartAlignment(restarted, pubBehindHedge).kind).toBe(RouteStartAlignmentKind.ALIGNED);
  });

  it("offers to reverse a one-way route that finishes at the walk's start", () => {
    const alignment = routeStartAlignment(linear, offset(1000, 1000));
    expect(alignment.kind).toBe(RouteStartAlignmentKind.FINISHES_AT_START);
    expect(routeStartAdjustable(alignment)).toBe(true);
  });

  it("only warns when a one-way route passes the start part way along", () => {
    const alignment = routeStartAlignment(linear, offset(500, 30));
    expect(alignment.kind).toBe(RouteStartAlignmentKind.PASSES_START);
    expect(routeStartAdjustable(alignment)).toBe(false);
  });

  it("only warns when the route never goes near the walk's start", () => {
    const alignment = routeStartAlignment(loop, offset(500, 500));
    expect(alignment.kind).toBe(RouteStartAlignmentKind.AWAY_FROM_START);
    expect(alignment.startPoint).toBeNull();
    expect(routeStartAdjustable(alignment)).toBe(false);
    expect(routeStartAlignmentMessage(alignment, "White Lion", metres)).toContain("does not pass the starting point");
  });

  it("describes a circular route that passes the start", () => {
    const alignment = routeStartAlignment(loop, offset(1000, 500));
    expect(routeStartAlignmentMessage(alignment, "White Lion", metres))
      .toBe("This route starts 1.1 km from the walk's starting point (White Lion). It is a circular route that passes the starting point 1.5 km in, so it can be adjusted to start and finish there.");
  });

  it("does nothing without a start location or a route", () => {
    expect(walkStartPoint({description: "No coordinates"})).toBeNull();
    expect(routeStartAlignment(loop, null)).toBeNull();
    expect(routeStartAlignment([offset(0, 0)], offset(0, 0))).toBeNull();
  });
});
