import axios from "axios";
import debug from "debug";
import { Request, Response } from "express";
import { envConfig } from "../env-config/env-config";
import { dateTimeNowAsValue } from "../shared/dates";
import { ParishBBox } from "../../../projects/ngx-ramblers/src/app/models/parish-map.model";
import { ParishQueryPage } from "./parish-cache.model";
import { parishBoundaryCache } from "../mongo/models/parish-boundary-cache";
import { ttlCached } from "../shared/ttl-cache";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const debugLog = debug(envConfig.logNamespace("parish-query"));
debugLog.enabled = true;

const ONS_PARISH_URL = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Parishes_and_Non_Civil_Parished_Areas_December_2024_Boundaries_EW_BFC/FeatureServer/0/query";
const MAX_RECORDS_PER_REQUEST = 2000;
const MAX_BBOX_DEGREES = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = ttlCached<GeoJSON.FeatureCollection>(CACHE_TTL_MS, 4);
const compress = promisify(gzip);
const decompress = promisify(gunzip);
const PERSISTENT_CACHE_TTL_MS = 30 * CACHE_TTL_MS;
const CACHE_GRID_SIZE = 20;

function cacheBounds(bounds: ParishBBox): ParishBBox {
  return {
    west: Math.floor(bounds.west * CACHE_GRID_SIZE) / CACHE_GRID_SIZE,
    south: Math.floor(bounds.south * CACHE_GRID_SIZE) / CACHE_GRID_SIZE,
    east: Math.ceil(bounds.east * CACHE_GRID_SIZE) / CACHE_GRID_SIZE,
    north: Math.ceil(bounds.north * CACHE_GRID_SIZE) / CACHE_GRID_SIZE
  };
}

function cacheKeyFor(bounds: ParishBBox): string {
  return `ons-2024-display-v1:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}

function compressedBytes(value: Uint8Array | {buffer: Uint8Array}): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  } else {
    return new Uint8Array(value.buffer);
  }
}

async function boundaryData(bounds: ParishBBox, key: string): Promise<GeoJSON.FeatureCollection> {
  const stored = await parishBoundaryCache.findOne({key}).exec().catch(error => {
    debugLog("Could not read persisted parish boundaries: %s", error.message);
    return null;
  });
  const cachedData = stored ? await decompress(compressedBytes(stored.compressedData))
    .then(data => JSON.parse(data.toString()) as GeoJSON.FeatureCollection)
    .catch(error => {
      debugLog("Could not decode persisted parish boundaries: %s", error.message);
      return null;
    }) : null;
  if (cachedData && dateTimeNowAsValue() - stored.timestamp < PERSISTENT_CACHE_TTL_MS) {
    return cachedData;
  } else {
    try {
      const features = await fetchAllPages(bounds.west, bounds.south, bounds.east, bounds.north);
      const data: GeoJSON.FeatureCollection = {type: "FeatureCollection", features};
      const compressedData = await compress(JSON.stringify(data));
      await parishBoundaryCache.updateOne({key}, {$set: {compressedData, timestamp: dateTimeNowAsValue()}}, {upsert: true}).exec().catch(error => {
        debugLog("Could not persist parish boundaries: %s", error.message);
      });
      return data;
    } catch (error) {
      if (cachedData) {
        debugLog("Using saved parish boundaries after ONS failure: %s", error.message);
        return cachedData;
      } else {
        throw error;
      }
    }
  }
}

async function fetchPage(west: number, south: number, east: number, north: number, offset: number): Promise<ParishQueryPage> {
  const response = await axios.get(ONS_PARISH_URL, {
    params: {
      where: "1=1",
      geometry: `${west},${south},${east},${north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "PARNCP24CD,PARNCP24NM",
      f: "geojson",
      outSR: 4326,
      resultRecordCount: MAX_RECORDS_PER_REQUEST,
      resultOffset: offset,
      maxAllowableOffset: 0.00005,
      geometryPrecision: 5,
      orderByFields: "PARNCP24CD"
    },
    timeout: 60000
  });

  const data = response.data;
  if (data.error || data.type !== "FeatureCollection" || !data.features) {
    throw new Error(data.error?.message ?? "Invalid parish boundary response");
  }
  return {
    features: data.features,
    hasMore: data.exceededTransferLimit === true
  };
}

async function fetchAllPages(west: number, south: number, east: number, north: number, accumulated: GeoJSON.Feature[] = [], offset = 0): Promise<GeoJSON.Feature[]> {
  const page = await fetchPage(west, south, east, north, offset);
  const allFeatures = [...accumulated, ...page.features];
  debugLog(`Fetched ${allFeatures.length} parishes so far (offset: ${offset}, hasMore: ${page.hasMore})`);

  if (page.hasMore) {
    return fetchAllPages(west, south, east, north, allFeatures, offset + MAX_RECORDS_PER_REQUEST);
  } else {
    return allFeatures;
  }
}

export async function queryParishes(req: Request, res: Response) {
  try {
    const west = parseFloat(req.query.west as string);
    const south = parseFloat(req.query.south as string);
    const east = parseFloat(req.query.east as string);
    const north = parseFloat(req.query.north as string);

    const bounds = {west, south, east, north};
    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north
      || west < -180 || east > 180 || south < -90 || north > 90) {
      res.status(400).json({error: "Missing or invalid bounding box parameters (west, south, east, north)"});
    } else if (north - south > MAX_BBOX_DEGREES || east - west > MAX_BBOX_DEGREES) {
      res.status(400).json({error: `Bounding box too large. Maximum is ${MAX_BBOX_DEGREES}° in each dimension. Please zoom in.`});
    } else {
      const normalisedBounds = cacheBounds(bounds);
      const key = cacheKeyFor(normalisedBounds);
      const startTime = dateTimeNowAsValue();
      const result = await cache.get(key, () => boundaryData(normalisedBounds, key));
      debugLog("Served %d parish boundaries in %dms", result.features.length, dateTimeNowAsValue() - startTime);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json(result);
    }
  } catch (error) {
    debugLog(`Error querying parishes: ${error.message}`);
    res.status(500).json({error: "Failed to fetch parish boundaries from ONS"});
  }
}
