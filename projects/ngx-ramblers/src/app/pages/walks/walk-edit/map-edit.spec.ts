import * as L from "leaflet";
import {Subject} from "rxjs";
import {MapEditComponent} from "./map-edit";
import {DEFAULT_OS_STYLE, LocationType, MapProvider} from "../../../models/map.model";
import {RouteWaypointKind} from "../../../models/route-follow.model";
import {SystemConfig} from "../../../models/system.model";

describe("walk thumbnail map initialisation", () => {
  function preview() {
    const configEvents = new Subject<SystemConfig>();
    const config = {value: null as SystemConfig | null};
    const component = Object.create(MapEditComponent.prototype) as MapEditComponent;
    const createBaseLayer = vi.fn(() => L.layerGroup());
    Object.assign(component, {
      preview: true,
      locationDetails: {latitude: 51.2, longitude: 0.7},
      systemConfigService: {systemConfig: () => config.value, events: () => configEvents},
      mapTiles: {
        hasOsApiKey: () => !!config.value?.externalSystems?.osMaps?.apiKey,
        createBaseLayer,
        crsForStyle: () => L.CRS.EPSG3857,
        maxZoomForStyle: () => 14,
        matchingZoom: () => 7
      },
      markerStyle: {smallPreviewPinIcon: () => L.divIcon()},
      mapZoom: {isDegenerateBounds: () => false},
      logger: {info: vi.fn(), error: vi.fn()},
      renderWaypoints: vi.fn()
    });
    return {component, config, configEvents, createBaseLayer};
  }

  it("waits for site settings before choosing OS Explorer rather than locking in OpenStreetMap", async () => {
    const {component, config, configEvents, createBaseLayer} = preview();
    const initialisation = component["prepareLocationsAndConfigure"]();
    expect(createBaseLayer).not.toHaveBeenCalled();
    config.value = {externalSystems: {osMaps: {apiKey: "fictional-key"}}} as SystemConfig;
    configEvents.next(config.value);
    await initialisation;
    expect(createBaseLayer).toHaveBeenCalledWith(MapProvider.OS, DEFAULT_OS_STYLE);
    expect(component.options.zoom).toBe(7);
  });

  it("does not create a map after the thumbnail is removed while settings are loading", async () => {
    const {component, configEvents, createBaseLayer} = preview();
    const initialisation = component["prepareLocationsAndConfigure"]();
    component["destroyed"] = true;
    configEvents.next({} as SystemConfig);
    await initialisation;
    expect(createBaseLayer).not.toHaveBeenCalled();
  });
});

describe("route start and finish on the walk location map", () => {
  const linear = [{latitude: 51.27, longitude: 0.93}, {latitude: 51.28, longitude: 0.94}, {latitude: 51.29, longitude: 0.95}];

  function locationMap(locationType: LocationType, latitude: number, longitude: number) {
    const component = Object.create(MapEditComponent.prototype) as MapEditComponent;
    const routeAnchorIcon = vi.fn(() => L.divIcon());
    Object.assign(component, {
      preview: false,
      showCombinedMap: false,
      locationType,
      locationDetails: {latitude, longitude},
      endLocationDetails: null,
      markerStyle: {routeAnchorIcon}
    });
    return {component, routeAnchorIcon};
  }

  it("marks where the route starts when it is away from the walk's start", () => {
    const {component, routeAnchorIcon} = locationMap(LocationType.STARTING, 51.2711, 0.9231);
    const markers = component["routeEndMarkers"](linear);
    expect(markers.length).toBe(1);
    expect(markers[0].getLatLng()).toEqual(L.latLng(51.27, 0.93));
    expect(routeAnchorIcon).toHaveBeenCalledWith(RouteWaypointKind.START);
  });

  it("adds no marker when the route starts close to the walk's start", () => {
    const {component} = locationMap(LocationType.STARTING, 51.2715, 0.9310);
    expect(component["routeEndMarkers"](linear)).toEqual([]);
  });

  it("adds no marker when the route starts at the walk's start", () => {
    const {component} = locationMap(LocationType.STARTING, 51.27, 0.93);
    expect(component["routeEndMarkers"](linear)).toEqual([]);
  });

  it("hides the route start at a walk pin on longitude zero", () => {
    const {component} = locationMap(LocationType.STARTING, 51.27, 0);
    expect(component["routeEndMarkers"]([{latitude: 51.27, longitude: 0}, {latitude: 51.29, longitude: 0.02}])).toEqual([]);
  });

  it("marks where a linear route finishes on the finish map", () => {
    const {component, routeAnchorIcon} = locationMap(LocationType.FINISHING, 51.3, 0.96);
    const markers = component["routeEndMarkers"](linear);
    expect(markers.length).toBe(1);
    expect(routeAnchorIcon).toHaveBeenCalledWith(RouteWaypointKind.END);
  });
});
