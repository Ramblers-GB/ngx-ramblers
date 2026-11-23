import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { isNumber } from "es-toolkit/compat";
import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { missingHeightIndices } from "../../../projects/ngx-ramblers/src/app/functions/route-elevation";
import { ROUTE_HEIGHTS_MAX_POINTS } from "../../../projects/ngx-ramblers/src/app/models/route-follow.model";
import { routeHeights } from "./route-heights";

const debugLog = debug(envConfig.logNamespace("gpx-height-enrichment"));

export function elevationElement(point: Element): Element | null {
  const children = point.childNodes;
  return Array.from({length: children.length}, (_, index) => children.item(index))
    .find((child): child is Element => child?.nodeType === 1 && (child as Element).localName === "ele") || null;
}

export async function gpxWithHeights(content: string): Promise<string> {
  try {
    const document = new DOMParser().parseFromString(content, "text/xml");
    const nodes = document.getElementsByTagName("*");
    const elements = Array.from({length: nodes.length}, (_, index) => nodes.item(index))
      .filter(element => element.localName === "trkpt" || element.localName === "rtept");
    const points = elements.map(element => {
      const elevation = parseFloat(elevationElement(element)?.textContent || "");
      return {
        latitude: parseFloat(element.getAttribute("lat") || ""),
        longitude: parseFloat(element.getAttribute("lon") || ""),
        elevation: Number.isFinite(elevation) ? elevation : null
      };
    });
    const missing = missingHeightIndices(points).filter(index => Number.isFinite(points[index].latitude) && Number.isFinite(points[index].longitude));
    if (missing.length === 0 || missing.length > ROUTE_HEIGHTS_MAX_POINTS) {
      return content;
    } else {
      const heights = await routeHeights(missing.map(index => points[index]));
      const changes = missing.filter((pointIndex, index) => isNumber(heights[index]) && Number.isFinite(heights[index]));
      missing.forEach((pointIndex, index) => {
        const height = heights[index];
        if (isNumber(height) && Number.isFinite(height)) {
          const element = elements[pointIndex];
          const existing = elevationElement(element);
          const elevation = existing || document.createElementNS(element.namespaceURI, "ele");
          elevation.textContent = String(height);
          if (!existing) {
            element.insertBefore(elevation, element.firstChild);
          }
        }
      });
      return changes.length > 0 ? new XMLSerializer().serializeToString(document) : content;
    }
  } catch (error) {
    debugLog("Could not enrich GPX heights; keeping the original file:", error);
    return content;
  }
}
