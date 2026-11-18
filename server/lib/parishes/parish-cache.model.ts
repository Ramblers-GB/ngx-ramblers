export interface ParishBoundaryCacheRecord {
  key: string;
  compressedData: Buffer;
  timestamp: number;
}

export interface ParishQueryPage {
  features: GeoJSON.Feature[];
  hasMore: boolean;
}
