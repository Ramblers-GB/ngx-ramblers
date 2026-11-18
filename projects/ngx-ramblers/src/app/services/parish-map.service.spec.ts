import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { LoggerTestingModule } from "ngx-logger/testing";
import { ParishMapService } from "./parish-map.service";

const bbox = {west: 0, south: 51, east: 1, north: 52};
const boundaries: GeoJSON.FeatureCollection = {type: "FeatureCollection", features: []};

describe("ParishMapService boundary reuse", () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [LoggerTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()]
  }));

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("shares an in-flight download and reuses its result when the map is reopened", () => {
    const service = TestBed.inject(ParishMapService);
    const http = TestBed.inject(HttpTestingController);
    const results: GeoJSON.FeatureCollection[] = [];
    service.queryParishes(bbox).subscribe(result => results.push(result));
    service.queryParishes(bbox).subscribe(result => results.push(result));
    http.expectOne(request => request.url === "/api/parishes/query").flush(boundaries);
    service.queryParishes(bbox).subscribe(result => results.push(result));
    http.expectNone(request => request.url === "/api/parishes/query");
    expect(results).toEqual([boundaries, boundaries, boundaries]);
  });

  it("retries a failed download instead of retaining the error", () => {
    const service = TestBed.inject(ParishMapService);
    const http = TestBed.inject(HttpTestingController);
    const failures: number[] = [];
    service.queryParishes(bbox).subscribe({error: error => failures.push(error.status)});
    http.expectOne(request => request.url === "/api/parishes/query").flush({}, {status: 503, statusText: "Unavailable"});
    const results: GeoJSON.FeatureCollection[] = [];
    service.queryParishes(bbox).subscribe(result => results.push(result));
    http.expectOne(request => request.url === "/api/parishes/query").flush(boundaries);
    expect(failures).toEqual([503]);
    expect(results).toEqual([boundaries]);
  });
});
