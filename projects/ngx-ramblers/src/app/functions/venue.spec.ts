import { placeNameChoiceFor, placeNamesMatch, resultPlaceName, storedMeetingVenue, venueMarkdownLink, venueSearchLabel } from "./venue";

describe("venue place names", () => {
  it("joins name and address without repeating a part already in the name", () => {
    expect(resultPlaceName({name: "Hillside Lane & Station Approach, Hillside Park", address1: "Hillside Park"})).toBe("Hillside Lane & Station Approach, Hillside Park");
    expect(resultPlaceName({name: "Hillside Lane", address1: "Hillside Park"})).toBe("Hillside Lane, Hillside Park");
  });

  it("treats names as the same ignoring extra spaces and case", () => {
    expect(placeNamesMatch("Hillside Park", "  hillside   park ")).toBe(true);
    expect(placeNamesMatch("Hillside Park", "Station Approach")).toBe(false);
  });

  it("offers a keep-or-replace choice only when the typed wording differs from the result", () => {
    expect(placeNameChoiceFor("Junction of Hillside Lane and Station Approach, Hillside Park", {
      name: "Hillside Lane & Station Approach, Hillside Park"
    })).toEqual({
      typed: "Junction of Hillside Lane and Station Approach, Hillside Park",
      fromResult: "Hillside Lane & Station Approach, Hillside Park"
    });
    expect(placeNameChoiceFor("Hillside Park", {name: "Hillside Park"})).toBeNull();
  });
});

describe("meeting venue maps link", () => {
  it("joins name, address and postcode without repeating a part", () => {
    expect(venueSearchLabel({
      name: "Village Hall",
      address1: "High Street",
      postcode: "CT1 2AB"
    })).toBe("Village Hall, High Street, CT1 2AB");
  });

  it("stores the place fields used on the invite and wraps them as a Google Maps link", () => {
    const stored = storedMeetingVenue({
      name: "Village Hall",
      address1: "High Street",
      postcode: "CT1 2AB",
      lat: 51.28,
      lon: 1.08,
      storedVenueId: "venue-1"
    });
    expect(stored).toEqual({
      storedVenueId: "venue-1",
      name: "Village Hall",
      address1: "High Street",
      postcode: "CT1 2AB",
      lat: 51.28,
      lon: 1.08
    });
    expect(venueMarkdownLink(stored)).toBe("[Village Hall, High Street, CT1 2AB](https://www.google.com/maps/search/?api=1&query=51.2800000,1.0800000)");
  });

  it("falls back to a Google Maps search for a typed place with no coordinates", () => {
    expect(venueMarkdownLink({name: "Village Hall"}, "Village Hall"))
      .toBe("[Village Hall](https://maps.google.co.uk/maps?q=Village%20Hall)");
  });
});
