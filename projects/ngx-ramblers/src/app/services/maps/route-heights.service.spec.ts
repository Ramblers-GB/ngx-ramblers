import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { LoggerTestingModule } from "ngx-logger/testing";
import { RouteHeightsService } from "./route-heights.service";

describe("RouteHeightsService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
  });

  it("fills in heights for a route drawn on the map", async () => {
    const service = TestBed.inject(RouteHeightsService);
    const http = TestBed.inject(HttpTestingController);
    const located = service.withHeights([{latitude: 51.2, longitude: 0.9}, {latitude: 51.21, longitude: 0.9}]);
    await Promise.resolve();
    const request = http.expectOne("/api/routes/heights");
    expect(request.request.body.points.length).toBe(2);
    request.flush({heights: [60, 75]});
    expect((await located).map(point => point.elevation)).toEqual([60, 75]);
  });

  it("keeps a recorded route's own heights without looking anything up", async () => {
    const service = TestBed.inject(RouteHeightsService);
    const http = TestBed.inject(HttpTestingController);
    const points = [{latitude: 51.2, longitude: 0.9, elevation: 40}, {latitude: 51.21, longitude: 0.9, elevation: 48}];
    expect(await service.withHeights(points)).toBe(points);
    expect(await service.ascentMetres(points)).toBe(8);
    http.expectNone("/api/routes/heights");
  });

  it("works out the ascent from looked-up heights when the route has none", async () => {
    const service = TestBed.inject(RouteHeightsService);
    const http = TestBed.inject(HttpTestingController);
    const ascent = service.ascentMetres([{latitude: 51.2, longitude: 0.9}, {latitude: 51.2006, longitude: 0.9}]);
    await Promise.resolve();
    const request = http.expectOne("/api/routes/heights");
    request.flush({heights: request.request.body.points.map((point: unknown, index: number) => 50 + index * 5)});
    expect(await ascent).toBe(10);
  });

  it("leaves the heights blank when the lookup fails", async () => {
    const service = TestBed.inject(RouteHeightsService);
    const http = TestBed.inject(HttpTestingController);
    const located = service.withHeights([{latitude: 51.2, longitude: 0.9, elevation: 0}, {latitude: 51.21, longitude: 0.9, elevation: 0}]);
    await Promise.resolve();
    http.expectOne("/api/routes/heights").flush("down", {status: 502, statusText: "Bad Gateway"});
    expect((await located).map(point => point.elevation)).toEqual([null, null]);
  });

  it("fills in the heights a partly recorded route is missing before working out the profile", async () => {
    const service = TestBed.inject(RouteHeightsService);
    const http = TestBed.inject(HttpTestingController);
    const located = service.elevationPoints([{latitude: 51.2, longitude: 0.9, elevation: 40}, {latitude: 51.201, longitude: 0.9}, {latitude: 51.202, longitude: 0.9, elevation: 60}]);
    await Promise.resolve();
    const request = http.expectOne("/api/routes/heights");
    expect(request.request.body.points.length).toBe(1);
    request.flush({heights: [50]});
    expect((await located).map(point => point.elevation)).toEqual([40, 50, 60]);
  });
});
