import { TestBed } from "@angular/core/testing";
import { RouteElevationComponent } from "./route-elevation";
import { RouteHeightsService } from "../../services/maps/route-heights.service";
import { RouteFollowService } from "../../services/maps/route-follow.service";
import { GridReferenceService } from "../../services/maps/grid-reference.service";
import { WalksConfigService } from "../../services/system/walks-config.service";
import { RouteFollowPoint } from "../../models/route-follow.model";

describe("route elevation display", () => {
  it("shows the terrain profile for a route that arrives without heights", async () => {
    const elevationPoints = vi.fn(async (points: RouteFollowPoint[]) => points.map((point, index) => ({...point, elevation: 30 + index * 10})));
    TestBed.configureTestingModule({providers: [
      {provide: RouteHeightsService, useValue: {elevationPoints}},
      {provide: RouteFollowService, useValue: {formatElevation: (height: number) => `${height} m`}},
      {provide: GridReferenceService, useValue: {fromLatLng: () => null}},
      {provide: WalksConfigService, useValue: {walksConfig: () => ({})}}
    ]});
    const fixture = TestBed.createComponent(RouteElevationComponent);
    const points = [{latitude: 51, longitude: 0}, {latitude: 51.01, longitude: 0.01}];
    fixture.componentRef.setInput("points", points);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Ascent 10 m");
    expect(fixture.nativeElement.querySelector("svg path")).toBeTruthy();
    expect(points[0]).not.toHaveProperty("elevation");
  });
});
