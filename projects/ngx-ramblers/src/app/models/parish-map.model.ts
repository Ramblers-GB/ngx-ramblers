import { Observable } from "rxjs";

export interface ParishBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ParishFeatureProperties {
  PARNCP24CD: string;
  PARNCP24NM: string;
}

export interface ParishBoundaryRequest {
  response: Observable<GeoJSON.FeatureCollection>;
  expiresAt: number;
}
