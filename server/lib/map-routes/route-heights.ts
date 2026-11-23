import { Request, Response } from "express";
import debug from "debug";
import { isArray, isNumber } from "es-toolkit/compat";
import { envConfig } from "../env-config/env-config";
import { valhallaBaseUrl } from "./route-turn-steps";
import {
  ROUTE_HEIGHTS_MAX_POINTS,
  RouteFollowPoint,
  RouteHeightsRequest,
  RouteHeightsResponse,
  ValhallaHeightResponse
} from "../../../projects/ngx-ramblers/src/app/models/route-follow.model";

const debugLog = debug(envConfig.logNamespace("route-heights"));
const VALHALLA_HEIGHT_TIMEOUT_MS = 20000;
const VALHALLA_HEIGHT_CHUNK = 1000;
const NO_DATA_METRES = -1000;

export function heightsFromValhalla(response: ValhallaHeightResponse | null, count: number): (number | null)[] {
  const heights = isArray(response?.height) ? response.height : [];
  return Array.from({length: count}, (_, index) => {
    const height = heights[index];
    return isNumber(height) && Number.isFinite(height) && height > NO_DATA_METRES ? height : null;
  });
}

export function chunked<T>(items: T[], size: number): T[][] {
  return Array.from({length: Math.ceil(items.length / size)}, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function valhallaHeights(points: RouteFollowPoint[]): Promise<(number | null)[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALHALLA_HEIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(`${valhallaBaseUrl()}/height`, {
      method: "POST",
      signal: controller.signal,
      headers: {"Content-Type": "application/json", "User-Agent": "ngx-ramblers route heights"},
      body: JSON.stringify({shape: points.map(point => ({lat: point.latitude, lon: point.longitude})), range: false})
    });
    if (!response.ok) {
      debugLog("valhalla height returned", response.status, await response.text());
      return heightsFromValhalla(null, points.length);
    } else {
      return heightsFromValhalla(await response.json() as ValhallaHeightResponse, points.length);
    }
  } catch (error) {
    debugLog("valhalla height failed:", error?.message || error);
    return heightsFromValhalla(null, points.length);
  } finally {
    clearTimeout(timer);
  }
}

export async function routeHeights(points: RouteFollowPoint[]): Promise<(number | null)[]> {
  return chunked(points, VALHALLA_HEIGHT_CHUNK).reduce(async (previous, chunk) => [...await previous, ...await valhallaHeights(chunk)], Promise.resolve([] as (number | null)[]));
}

export async function routeHeightsHandler(req: Request, res: Response): Promise<void> {
  const request = req.body as RouteHeightsRequest;
  const points = isArray(request?.points) ? request.points : [];
  const validPoints = points.every(point => isNumber(point?.latitude) && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && isNumber(point?.longitude) && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180);
  if (points.length === 0) {
    res.status(400).json({message: "No route points were supplied"});
  } else if (!validPoints) {
    res.status(400).json({message: "Every route point must have valid latitude and longitude coordinates"});
  } else if (points.length > ROUTE_HEIGHTS_MAX_POINTS) {
    res.status(400).json({message: `A route can have at most ${ROUTE_HEIGHTS_MAX_POINTS} points for a height lookup`});
  } else {
    const response: RouteHeightsResponse = {heights: await routeHeights(points)};
    res.json(response);
  }
}
