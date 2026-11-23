import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom, timeout } from "rxjs";
import { isNumber } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import {
  ROUTE_ASCENT_THRESHOLD_METRES,
  ROUTE_HEIGHTS_SAMPLE_MAX_POINTS,
  ROUTE_HEIGHTS_SAMPLE_METRES,
  ROUTE_HEIGHTS_TIMEOUT_MS,
  RouteFollowPoint,
  RouteHeightsResponse
} from "../../models/route-follow.model";
import { evenlySpacedRoutePoints, missingHeightIndices, routeHasElevation, smoothedAscentMetres } from "../../functions/route-elevation";
import { LoggerFactory } from "../logger-factory.service";

@Injectable({providedIn: "root"})
export class RouteHeightsService {
  private http = inject(HttpClient);
  private logger = inject(LoggerFactory).createLogger("RouteHeightsService", NgxLoggerLevel.ERROR);

  async heightsFor(points: RouteFollowPoint[]): Promise<(number | null)[]> {
    try {
      const response = await firstValueFrom(this.http.post<RouteHeightsResponse>("/api/routes/heights", {
        points: points.map(point => ({latitude: point.latitude, longitude: point.longitude}))
      }).pipe(timeout(ROUTE_HEIGHTS_TIMEOUT_MS)));
      return points.map((point, index) => response?.heights?.[index] ?? null);
    } catch (error) {
      this.logger.warn("route heights unavailable", error);
      return points.map(() => null);
    }
  }

  async withHeights(points: RouteFollowPoint[]): Promise<RouteFollowPoint[]> {
    const missing = missingHeightIndices(points);
    if (missing.length === 0) {
      return points;
    } else {
      const heights = await this.heightsFor(missing.map(index => points[index]));
      const found = new Map(missing.map((pointIndex, index) => [pointIndex, heights[index]]));
      return points.map((point, index) => {
        const height = found.get(index);
        return found.has(index) ? {...point, elevation: isNumber(height) ? height : null} : point;
      });
    }
  }

  async elevationPoints(points: RouteFollowPoint[]): Promise<RouteFollowPoint[]> {
    if (points.length < 2 || missingHeightIndices(points).length === 0) {
      return points;
    } else if (routeHasElevation(points)) {
      return this.withHeights(points);
    } else {
      return this.withHeights(evenlySpacedRoutePoints(points, ROUTE_HEIGHTS_SAMPLE_METRES, ROUTE_HEIGHTS_SAMPLE_MAX_POINTS));
    }
  }

  async ascentMetres(points: RouteFollowPoint[]): Promise<number> {
    const located = await this.elevationPoints(points);
    return points.length < 2 ? 0 : smoothedAscentMetres(located.map(point => point.elevation), ROUTE_ASCENT_THRESHOLD_METRES);
  }
}
