import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { WalkRouteStartCheckComponent } from "./walk-route-start-check";
import { RouteFollowPayloadService } from "../../../services/maps/route-follow-payload.service";
import { RouteFollowService } from "../../../services/maps/route-follow.service";
import { RouteFollowPoint } from "../../../models/route-follow.model";
import { LocationDetails } from "../../../models/ramblers-walks-manager.model";

const origin = {latitude: 51.26, longitude: 0.93};

function offset(northMetres: number, eastMetres: number): RouteFollowPoint {
  return {
    latitude: origin.latitude + northMetres / 111320,
    longitude: origin.longitude + eastMetres / (111320 * Math.cos(origin.latitude * Math.PI / 180))
  };
}

const loop = [offset(0, 0), offset(1000, 0), offset(1000, 1000), offset(0, 1000), offset(0, 0)];

async function render(start: RouteFollowPoint) {
  const routePoints = vi.fn().mockResolvedValue(loop);
  TestBed.configureTestingModule({
    imports: [WalkRouteStartCheckComponent],
    providers: [
      {provide: RouteFollowPayloadService, useValue: {routePoints}},
      {provide: RouteFollowService, useValue: {formatDistance: (metres: number) => `${(metres / 1000).toFixed(1)} km`}}
    ]
  });
  const fixture = TestBed.createComponent(WalkRouteStartCheckComponent);
  fixture.componentRef.setInput("gpxFile", {awsFileName: "route.gpx", title: "Recce"});
  fixture.componentRef.setInput("startLocation", {...start, description: "White Lion"} as LocationDetails);
  fixture.detectChanges();
  await fixture.whenStable();
  await vi.waitFor(() => expect(routePoints).toHaveBeenCalled());
  await Promise.resolve();
  fixture.detectChanges();
  return fixture;
}

describe("walk route start check", () => {
  it("warns when a circular route starts away from the walk's start and offers to adjust a copy", async () => {
    const fixture = await render(offset(1000, 500));
    const adjust = vi.fn();
    fixture.componentInstance.adjust.subscribe(adjust);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain("Route does not start at the walk's start");
    expect(text).toContain("starts 1.1 km from the walk's starting point (White Lion)");
    expect(text).toContain("The original route file is not changed");
    fixture.nativeElement.querySelector("button").click();
    expect(adjust).toHaveBeenCalled();
  });

  it("says nothing when the route starts at the walk's start", async () => {
    const fixture = await render(offset(30, 0));
    expect(fixture.nativeElement.textContent.trim()).toBe("");
  });

  it("warns without an adjust button when the route never goes near the start", async () => {
    const fixture = await render(offset(500, 500));
    expect(fixture.nativeElement.textContent).toContain("does not pass the starting point");
    expect(fixture.nativeElement.querySelector("button")).toBeNull();
  });
});
