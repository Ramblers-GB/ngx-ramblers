import * as L from "leaflet";
import { TestBed } from "@angular/core/testing";
import { LoggerTestingModule } from "ngx-logger/testing";
import { MapZoomService } from "./map-zoom.service";

describe("MapZoomService", () => {
  let service: MapZoomService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule]
    });
    service = TestBed.inject(MapZoomService);
  });

  it("treats identical start and finish pins as degenerate bounds", () => {
    const pin = L.latLng(52.456, -2.141);
    const bounds = L.latLngBounds(pin, pin).pad(0.25);
    expect(service.isDegenerateBounds(bounds)).toBe(true);
  });

  it("keeps a real start-to-finish span as fit-able bounds", () => {
    const start = L.latLng(52.456, -2.141);
    const finish = L.latLng(52.48, -2.12);
    const bounds = L.latLngBounds(start, finish).pad(0.25);
    expect(service.isDegenerateBounds(bounds)).toBe(false);
  });

  it("leaves the map unchanged when the bounds are invalid", () => {
    const map = {setView: vi.fn(), fitBounds: vi.fn()} as unknown as L.Map;

    expect(() => service.applyBoundsToMap(map, L.latLngBounds([]))).not.toThrow();
    expect(map.setView).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("zooms to a single-point view instead of max zoom when bounds collapse", () => {
    const pin = L.latLng(52.456, -2.141);
    const bounds = L.latLngBounds(pin, pin);
    const map = {
      getZoom: () => 19,
      getMaxZoom: () => 19,
      setView: vi.fn(),
      fitBounds: vi.fn()
    } as unknown as L.Map;

    service.applyBoundsToMap(map, bounds, {maxZoom: 15});

    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenCalledWith(expect.any(Object), 13);
  });
});
