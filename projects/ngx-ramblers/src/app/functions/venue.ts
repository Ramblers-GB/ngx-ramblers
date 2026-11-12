import { PlaceNameChoice, Venue } from "../models/event-venue.model";
import { googleMapsPlaceUrl, googleMapsSearchUrl, withoutTrailingPostcode } from "./locate";
import { isNumber } from "es-toolkit/compat";

export function resultPlaceName(venue: { name?: string; address1?: string }): string {
  const name = withoutTrailingPostcode(venue.name);
  const address = withoutTrailingPostcode(venue.address1);
  if (address && !name.toLowerCase().includes(address.toLowerCase())) {
    return `${name}, ${address}`;
  } else {
    return name;
  }
}

export function placeNamesMatch(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim().toLowerCase() === right.replace(/\s+/g, " ").trim().toLowerCase();
}

export function venueSearchLabel(venue: { name?: string; address1?: string; postcode?: string } | null): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of [venue?.name, venue?.address1, venue?.postcode]) {
    const trimmed = (part || "").trim();
    const key = trimmed.toUpperCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      parts.push(trimmed);
    }
  }
  return parts.join(", ");
}

export function storedMeetingVenue(venue: Venue | null): Venue | null {
  if (!venue?.name && !venue?.postcode && !venue?.address1) {
    return null;
  } else {
    return {
      ...(venue.storedVenueId ? {storedVenueId: venue.storedVenueId} : {}),
      ...(venue.type ? {type: venue.type} : {}),
      ...(venue.name ? {name: venue.name} : {}),
      ...(venue.address1 ? {address1: venue.address1} : {}),
      ...(venue.address2 ? {address2: venue.address2} : {}),
      ...(venue.postcode ? {postcode: venue.postcode} : {}),
      ...(isNumber(venue.lat) ? {lat: venue.lat} : {}),
      ...(isNumber(venue.lon) ? {lon: venue.lon} : {}),
      ...(venue.url ? {url: venue.url} : {})
    };
  }
}

export function venueMapsUrl(venue: Venue | null, fallback = ""): string {
  if (venue && isNumber(venue.lat) && isNumber(venue.lon)) {
    return googleMapsPlaceUrl(venue.lat, venue.lon) || "";
  } else {
    const query = venueSearchLabel(venue) || fallback.trim();
    return query ? googleMapsSearchUrl(query) : "";
  }
}

export function venueMarkdownLink(venue: Venue | null, fallback = ""): string {
  const label = venueSearchLabel(venue) || fallback.trim();
  const url = venueMapsUrl(venue, label);
  if (!label) {
    return fallback.trim();
  } else if (!url) {
    return label;
  } else {
    return `[${label}](${url})`;
  }
}

export function placeNameChoiceFor(typed: string, venue: { name?: string; address1?: string }): PlaceNameChoice | null {
  const fromResult = resultPlaceName(venue);
  if (typed && fromResult && !placeNamesMatch(typed, fromResult)) {
    return {typed, fromResult};
  } else {
    return null;
  }
}
