import { AppPath, followRouteCommands, RouteFollowSession, RouteFollowSummary } from "../models/route-follow.model";
import { StoredValue } from "../models/ui-actions.model";

export function followRouteLink(route: RouteFollowSummary | RouteFollowSession): string[] {
  if (route.routeNumber) {
    const title = "title" in route ? route.title : route.payload?.title;
    return followRouteCommands(route.routeNumber, title);
  } else {
    return ["/", AppPath.ROOT, AppPath.ROUTE];
  }
}

export function followRouteQuery(route: RouteFollowSummary | RouteFollowSession): Record<string, string> {
  const params: Record<string, string> = {};
  if (route.routeNumber) {
    if ("trackIndex" in route && route.trackIndex) {
      params[StoredValue.TRACK] = String(route.trackIndex);
    }
    if ("via" in route && route.via?.length) {
      params[StoredValue.VIA] = route.via.join(",");
    }
  } else {
    if (route.recordingId) {
      params[StoredValue.RECORD_ROUTE] = route.recordingId;
    }
    if (route.path) {
      params[StoredValue.FOLLOW_PATH] = route.path;
    }
    if (route.routeId) {
      params[StoredValue.ROUTE_ID] = route.routeId;
    }
    if (route.ramblersSlug) {
      params[StoredValue.RAMBLERS_SLUG] = route.ramblersSlug;
    }
    if (route.osMapsRouteId) {
      params[StoredValue.OS_MAPS_ROUTE_ID] = route.osMapsRouteId;
    }
    if (route.walkId) {
      params[StoredValue.WALK_ID] = route.walkId;
    }
    if ("trackIndex" in route && route.trackIndex) {
      params[StoredValue.TRACK] = String(route.trackIndex);
    }
    if ("via" in route && route.via?.length) {
      params[StoredValue.VIA] = route.via.join(",");
    }
  }
  return params;
}
