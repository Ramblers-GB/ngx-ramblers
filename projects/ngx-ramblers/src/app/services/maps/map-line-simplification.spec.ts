import * as L from "leaflet";
import { installLeafletLineSimplification, simplifiedMapLine } from "./map-line-simplification";
import { SimplifiableMapPolyline } from "../../models/map.model";

describe("map line simplification", () => {
  it("retains Leaflet's visible geometry at the same pixel tolerance", () => {
    const points = Array.from({length: 1500}, (_, index) => L.point(index / 5, Math.sin(index / 17) * 40 + Math.cos(index / 3)));
    for (const tolerance of [0, 0.5, 1, 3, 10]) {
      expect(simplifiedMapLine(points, tolerance)).toEqual(L.LineUtil.simplify(points, tolerance));
    }
    expect(simplifiedMapLine([], 1)).toEqual([]);
    expect(simplifiedMapLine([points[0]], 1)).toEqual([points[0]]);
  });

  it("handles a deeply subdivided line without overflowing the call stack", () => {
    const points = Array.from({length: 12000}, (_, index) => L.point(index, index % 2 ? 10 : 0));
    expect(simplifiedMapLine(points, 0.5)).toEqual(points);
  });

  it("uses the safe simplifier for route lines and parish polygons", () => {
    installLeafletLineSimplification();
    const points = [L.point(0, 0), L.point(1, 0), L.point(2, 0)];
    for (const layer of [L.polyline([]), L.polygon([])]) {
      const polyline = layer as SimplifiableMapPolyline;
      polyline._parts = [points];
      (polyline as any)._simplifyPoints();
      expect(polyline._parts).toEqual([[points[0], points[2]]]);
    }
  });
});
