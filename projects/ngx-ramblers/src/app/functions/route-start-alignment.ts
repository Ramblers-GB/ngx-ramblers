import { isNumber } from "es-toolkit/compat";
import { LocationDetails } from "../models/ramblers-walks-manager.model";
import {
  ROUTE_FOLLOW_LOOP_CLOSURE_METRES,
  ROUTE_START_ALIGNED_METRES,
  ROUTE_START_NEAREST_POINT_METRES,
  ROUTE_START_ON_ROUTE_METRES,
  RouteFollowPoint,
  RouteStartAlignment,
  RouteStartAlignmentKind
} from "../models/route-follow.model";
import { cumulativeDistances, isClosedLoop, metresBetween, snapToRoute } from "./route-geometry";

export function walkStartPoint(location: Partial<LocationDetails> | null | undefined): RouteFollowPoint | null {
  return isNumber(location?.latitude) && isNumber(location?.longitude)
    ? {latitude: location.latitude, longitude: location.longitude}
    : null;
}

export function routeStartAlignment(points: RouteFollowPoint[], walkStart: RouteFollowPoint | null): RouteStartAlignment | null {
  if (!walkStart || points.length < 2) {
    return null;
  } else {
    const routeStartMetres = metresBetween(points[0], walkStart);
    const snap = snapToRoute(points, cumulativeDistances(points), walkStart);
    const onRoute = !!snap && snap.distanceMetres <= ROUTE_START_ON_ROUTE_METRES;
    const startsNearestToWalkStart = onRoute && snap.progressMetres <= ROUTE_START_NEAREST_POINT_METRES;
    const kind = routeStartMetres <= ROUTE_START_ALIGNED_METRES || startsNearestToWalkStart
      ? RouteStartAlignmentKind.ALIGNED
      : onRoute && isClosedLoop(points, ROUTE_FOLLOW_LOOP_CLOSURE_METRES)
        ? RouteStartAlignmentKind.LOOP_PASSES_START
        : metresBetween(points[points.length - 1], walkStart) <= ROUTE_START_ALIGNED_METRES
          ? RouteStartAlignmentKind.FINISHES_AT_START
          : onRoute
            ? RouteStartAlignmentKind.PASSES_START
            : RouteStartAlignmentKind.AWAY_FROM_START;
    return {
      kind,
      routeStartMetres,
      passesAtMetres: onRoute ? snap.progressMetres : null,
      startPoint: onRoute ? snap.point : null
    };
  }
}

export function routeStartAdjustable(alignment: RouteStartAlignment | null): boolean {
  return alignment?.kind === RouteStartAlignmentKind.LOOP_PASSES_START || alignment?.kind === RouteStartAlignmentKind.FINISHES_AT_START;
}

export function routeStartNeedsAttention(alignment: RouteStartAlignment | null): boolean {
  return !!alignment && alignment.kind !== RouteStartAlignmentKind.ALIGNED;
}

export function routeStartAlignmentMessage(alignment: RouteStartAlignment, startName: string, formatDistance: (metres: number) => string): string {
  const away = `This route starts ${formatDistance(alignment.routeStartMetres)} from the walk's starting point (${startName}).`;
  if (alignment.kind === RouteStartAlignmentKind.LOOP_PASSES_START) {
    return `${away} It is a circular route that passes the starting point ${formatDistance(alignment.passesAtMetres)} in, so it can be adjusted to start and finish there.`;
  } else if (alignment.kind === RouteStartAlignmentKind.FINISHES_AT_START) {
    return `${away} It finishes at the starting point, so it may have been recorded the other way round and can be reversed.`;
  } else if (alignment.kind === RouteStartAlignmentKind.PASSES_START) {
    return `${away} It passes the starting point ${formatDistance(alignment.passesAtMetres)} in, but it is not a circular route, so it cannot be adjusted automatically. Check the route and the starting point.`;
  } else {
    return `${away} It does not pass the starting point, so either the route or the starting point may be wrong.`;
  }
}

export function routeStartAdjustLabel(alignment: RouteStartAlignment, startName: string): string {
  return alignment.kind === RouteStartAlignmentKind.FINISHES_AT_START ? "Reverse the route" : `Start the route at ${startName}`;
}
