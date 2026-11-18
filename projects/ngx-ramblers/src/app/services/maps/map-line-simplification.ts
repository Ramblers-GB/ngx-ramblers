import * as L from "leaflet";
import { simplifiedLinePoints } from "../../functions/route-geometry";
import { SimplifiableMapPolyline } from "../../models/map.model";

const installation = {done: false};

export function simplifiedMapLine(points: L.Point[], tolerance: number): L.Point[] {
  if (!tolerance || points.length === 0) {
    return points.slice();
  } else {
    const pixelTolerance = Math.abs(tolerance);
    const reduced = points.reduce((kept, point) => {
      if (kept.length === 0 || point.distanceTo(kept[kept.length - 1]) > pixelTolerance) {
        kept.push(point);
      }
      return kept;
    }, [] as L.Point[]);
    if (reduced[reduced.length - 1] !== points[points.length - 1]) {
      reduced.push(points[points.length - 1]);
    }
    return simplifiedLinePoints(reduced, pixelTolerance, L.LineUtil.pointToSegmentDistance);
  }
}

export function installLeafletLineSimplification(): void {
  if (!installation.done) {
    installation.done = true;
    L.Polyline.include({
      _simplifyPoints(this: SimplifiableMapPolyline): void {
        this._parts = this._parts.map(part => simplifiedMapLine(part, this.options.smoothFactor));
      }
    });
  }
}
