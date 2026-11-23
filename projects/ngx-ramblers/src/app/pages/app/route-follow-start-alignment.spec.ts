import { describe, expect, it, vi } from "vitest";
import { RouteFollowComponent } from "./route-follow";
import { ROUTE_START_COPY_NOTE, RouteFollowMode, RouteFollowPoint, RouteFollowSource, RouteStartAlignmentKind } from "../../models/route-follow.model";

const origin = {latitude: 51.26, longitude: 0.93};

function offset(northMetres: number, eastMetres: number): RouteFollowPoint {
  return {
    latitude: origin.latitude + northMetres / 111320,
    longitude: origin.longitude + eastMetres / (111320 * Math.cos(origin.latitude * Math.PI / 180))
  };
}

const loop = [offset(0, 0), offset(1000, 0), offset(1000, 1000), offset(0, 1000), offset(0, 0)];

function routeScreen(options: {source?: RouteFollowSource; canEdit?: boolean; mode?: RouteFollowMode; start?: RouteFollowPoint}) {
  const instance = Object.create(RouteFollowComponent.prototype) as RouteFollowComponent;
  const editRoute = vi.fn();
  const moveStartTo = vi.fn();
  const reverseRoute = vi.fn();
  Object.assign(instance, {
    payload: {source: options.source ?? RouteFollowSource.WALK, guide: {start_location: {...(options.start ?? offset(1000, 500)), description: "White Lion"}}},
    canEditRoute: options.canEdit ?? true,
    progress: {mode: options.mode ?? RouteFollowMode.IDLE},
    startAlignmentDismissed: false,
    persistMessage: "",
    followService: {formatDistance: (metres: number) => `${Math.round(metres)} m`},
    editRoute,
    moveStartTo,
    reverseRoute
  });
  (instance as any).refreshStartAlignment(loop);
  return {instance: instance as any, editRoute, moveStartTo, reverseRoute};
}

describe("route screen start alignment", () => {
  it("asks a walk editor before restarting a circular route at the walk's start, then edits it for saving as a copy", () => {
    const {instance, editRoute, moveStartTo} = routeScreen({});
    expect(instance.showStartAlignment).toBe(true);
    expect(instance.startAlignment.kind).toBe(RouteStartAlignmentKind.LOOP_PASSES_START);
    expect(instance.startAlignmentLabel).toBe("Start the route at White Lion");
    expect(moveStartTo).not.toHaveBeenCalled();
    instance.adjustRouteStart();
    expect(editRoute).toHaveBeenCalled();
    expect(moveStartTo).toHaveBeenCalledWith(instance.startAlignment.startPoint);
    expect(instance.persistMessage).toBe(ROUTE_START_COPY_NOTE);
  });

  it("reverses a route that finishes at the walk's start", () => {
    const {instance, reverseRoute} = routeScreen({start: offset(0, 1000), mode: RouteFollowMode.EDITING});
    (instance as any).refreshStartAlignment(loop.slice(0, 4));
    expect(instance.startAlignmentLabel).toBe("Reverse the route");
    instance.adjustRouteStart();
    expect(reverseRoute).toHaveBeenCalled();
  });

  it("leaves the route alone when the editor dismisses the warning", () => {
    const {instance, moveStartTo} = routeScreen({});
    instance.startAlignmentDismissed = true;
    expect(instance.showStartAlignment).toBe(false);
    expect(moveStartTo).not.toHaveBeenCalled();
  });

  it("does not check routes for people who cannot edit them, routes that are not on a walk, or while following", () => {
    expect(routeScreen({canEdit: false}).instance.showStartAlignment).toBe(false);
    expect(routeScreen({source: RouteFollowSource.PAGE}).instance.showStartAlignment).toBe(false);
    expect(routeScreen({mode: RouteFollowMode.FOLLOWING}).instance.showStartAlignment).toBe(false);
  });
});
