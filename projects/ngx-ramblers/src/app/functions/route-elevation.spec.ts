import { elevationSvgPath, evenlySpacedRoutePoints, missingHeightIndices, routeElevationStats, smoothedAscentMetres } from "./route-elevation";
import { RouteFollowPoint } from "../models/route-follow.model";

const climb: RouteFollowPoint[] = [
  {latitude: 51.2, longitude: 0.7, elevation: 10},
  {latitude: 51.201, longitude: 0.7, elevation: 40},
  {latitude: 51.202, longitude: 0.7, elevation: 25}
];

describe("routeElevationStats", () => {
  it("returns null when fewer than two points have elevation", () => {
    expect(routeElevationStats([{latitude: 51, longitude: 0}, {latitude: 51.1, longitude: 0}])).toBeNull();
    expect(routeElevationStats([{latitude: 51, longitude: 0, elevation: 12}])).toBeNull();
  });

  it("returns null when every recorded height is zero", () => {
    expect(routeElevationStats([
      {latitude: 51.2, longitude: 0.7, elevation: 0},
      {latitude: 51.201, longitude: 0.7, elevation: 0}
    ])).toBeNull();
  });

  it("records min, max, ascent and descent along the line", () => {
    const stats = routeElevationStats(climb);
    expect(stats.minMetres).toBe(10);
    expect(stats.maxMetres).toBe(40);
    expect(stats.ascentMetres).toBe(30);
    expect(stats.descentMetres).toBe(15);
    expect(stats.samples.length).toBe(3);
  });
});

describe("elevationSvgPath", () => {
  it("starts at the first sample and ends at the last", () => {
    const stats = routeElevationStats(climb);
    const path = elevationSvgPath(stats, 100, 40);
    expect(path.startsWith("M")).toBe(true);
    expect(path).toContain(" L");
  });
});

describe("route heights", () => {
  it("treats a route saved with every height at zero as having no heights", () => {
    expect(missingHeightIndices([
      {latitude: 51.2, longitude: 0.7, elevation: 0},
      {latitude: 51.21, longitude: 0.7, elevation: 0}
    ])).toEqual([0, 1]);
  });

  it("only asks for the heights a route is missing", () => {
    expect(missingHeightIndices([
      {latitude: 51.2, longitude: 0.7, elevation: 40},
      {latitude: 51.21, longitude: 0.7},
      {latitude: 51.22, longitude: 0.7, elevation: 44}
    ])).toEqual([1]);
  });

  it("samples a straight route evenly along its length", () => {
    const sampled = evenlySpacedRoutePoints([{latitude: 51.2, longitude: 0.7}, {latitude: 51.201, longitude: 0.7}], 30, 100);
    expect(sampled.length).toBe(4);
    expect(sampled[3]).toEqual({latitude: 51.201, longitude: 0.7});
  });

  it("caps the number of samples on a long route", () => {
    expect(evenlySpacedRoutePoints([{latitude: 51.2, longitude: 0.7}, {latitude: 51.3, longitude: 0.7}], 30, 50).length).toBe(50);
  });

  it("ignores small ups and downs when adding up the ascent", () => {
    expect(smoothedAscentMetres([50, 51, 50, 51, 50, 52, 50], 3)).toBe(0);
    expect(smoothedAscentMetres([50, 55, 60, 58, 70, 40, 45], 3)).toBe(25);
  });
});
