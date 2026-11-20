import { isArray, isNumber } from "es-toolkit/compat";
import { RouteFollowPoint, ROUTE_FOLLOW_PATH_ROUTER_URL } from "../models/route-follow.model";

export function walkingPathUrl(from: RouteFollowPoint, to: RouteFollowPoint): string {
  return `${ROUTE_FOLLOW_PATH_ROUTER_URL}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
}

export function walkingPathFromResponse(body: unknown): RouteFollowPoint[] | null {
  const coordinates = (body as {routes?: {geometry?: {coordinates?: unknown}}[]})?.routes?.[0]?.geometry?.coordinates;
  const points = isArray(coordinates)
    ? coordinates
      .filter(coordinate => isArray(coordinate) && isNumber(coordinate[0]) && isNumber(coordinate[1]))
      .map(coordinate => ({latitude: coordinate[1] as number, longitude: coordinate[0] as number}))
    : [];
  return points.length >= 2 ? points : null;
}
