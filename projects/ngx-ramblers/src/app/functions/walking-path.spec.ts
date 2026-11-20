import { walkingPathFromResponse, walkingPathUrl } from "./walking-path";

describe("walking path", () => {
  it("asks the walking router for the path between two points, longitude first", () => {
    expect(walkingPathUrl({latitude: 51.2, longitude: 1.0}, {latitude: 51.3, longitude: 1.1}))
      .toContain("/1,51.2;1.1,51.3?overview=full&geometries=geojson");
  });

  it("reads the path from the router's reply", () => {
    const body = {routes: [{geometry: {coordinates: [[1.0, 51.2], [1.05, 51.25], [1.1, 51.3]]}}]};
    expect(walkingPathFromResponse(body)).toEqual([
      {latitude: 51.2, longitude: 1.0},
      {latitude: 51.25, longitude: 1.05},
      {latitude: 51.3, longitude: 1.1}
    ]);
  });

  it("gives nothing when the router found no path", () => {
    expect(walkingPathFromResponse({code: "NoRoute", routes: []})).toBeNull();
    expect(walkingPathFromResponse(null)).toBeNull();
    expect(walkingPathFromResponse({routes: [{geometry: {coordinates: [[1.0, 51.2]]}}]})).toBeNull();
  });
});
