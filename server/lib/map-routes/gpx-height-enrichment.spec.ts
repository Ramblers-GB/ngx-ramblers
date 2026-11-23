import expect from "expect";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import * as heights from "./route-heights";
import { gpxWithHeights } from "./gpx-height-enrichment";

const original = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Hillside trail</name></metadata><trk><trkseg><trkpt lat="51" lon="0"><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="51.01" lon="0.01"><ele>45</ele></trkpt></trkseg></trk></gpx>';

describe("GPX height enrichment", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it("fills missing heights while preserving existing heights and metadata", async () => {
    const lookup = sandbox.stub(heights, "routeHeights").resolves([30]);
    const enriched = await gpxWithHeights(original);
    expect(lookup.firstCall.args[0]).toEqual([{latitude: 51, longitude: 0, elevation: null}]);
    expect(enriched).toContain('<ele>30</ele><time>2026-01-01T10:00:00Z</time>');
    expect(enriched).toContain('<ele>45</ele>');
    expect(enriched).toContain('<name>Hillside trail</name>');
    lookup.resetHistory();
    expect(await gpxWithHeights(enriched)).toBe(enriched);
    expect(lookup.called).toBe(false);
  });

  it("keeps the original file when the terrain service has no heights", async () => {
    sandbox.stub(heights, "routeHeights").resolves([null]);
    expect(await gpxWithHeights(original)).toBe(original);
  });

  it("keeps the original file when a lookup fails", async () => {
    sandbox.stub(heights, "routeHeights").rejects(new Error("unavailable"));
    expect(await gpxWithHeights(original)).toBe(original);
  });

  it("fills zero-only route heights and preserves separate tracks", async () => {
    sandbox.stub(heights, "routeHeights").resolves([20, 35]);
    const enriched = await gpxWithHeights('<gpx><trk><trkseg><trkpt lat="51" lon="0"><ele>0</ele></trkpt></trkseg></trk><trk><trkseg><trkpt lat="52" lon="1"><ele>0</ele></trkpt></trkseg></trk></gpx>');
    expect(enriched).toContain('<ele>20</ele>');
    expect(enriched).toContain('<ele>35</ele>');
    expect(enriched.match(/<trk>/g)?.length).toBe(2);
  });

  it("reads a namespaced elevation and does not add a second one", async () => {
    const lookup = sandbox.stub(heights, "routeHeights").resolves([25]);
    const enriched = await gpxWithHeights('<gpx xmlns:g="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="51" lon="0"><g:ele>12</g:ele></trkpt><trkpt lat="51.001" lon="0"></trkpt></trkseg></trk></gpx>');
    expect(lookup.firstCall.args[0].length).toBe(1);
    expect(enriched.match(/ele>12</g)?.length).toBe(1);
    expect(enriched.match(/<[a-z:]*ele[ >]/g)?.length).toBe(2);
  });
});
