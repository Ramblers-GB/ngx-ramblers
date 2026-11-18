import { inject, Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { catchError, Observable, shareReplay, throwError } from "rxjs";
import { ParishBBox, ParishBoundaryRequest } from "../models/parish-map.model";
import { Logger, LoggerFactory } from "./logger-factory.service";
import { NgxLoggerLevel } from "ngx-logger";

@Injectable({providedIn: "root"})
export class ParishMapService {
  private http = inject(HttpClient);
  private logger: Logger = inject(LoggerFactory).createLogger("ParishMapService", NgxLoggerLevel.ERROR);

  private boundaries = new Map<string, ParishBoundaryRequest>();

  queryParishes(bbox: ParishBBox): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams()
      .set("west", bbox.west.toString())
      .set("south", bbox.south.toString())
      .set("east", bbox.east.toString())
      .set("north", bbox.north.toString());
    this.logger.info("Querying parishes for bounds:", bbox);
    const key = params.toString();
    const now = performance.now();
    if (!this.boundaries.has(key) || this.boundaries.get(key).expiresAt <= now) {
      this.boundaries.set(key, {expiresAt: now + 24 * 60 * 60 * 1000, response: this.http.get<GeoJSON.FeatureCollection>("/api/parishes/query", {params}).pipe(
        catchError(error => {
          this.boundaries.delete(key);
          return throwError(() => error);
        }),
        shareReplay({bufferSize: 1, refCount: false})
      )});
    }
    return this.boundaries.get(key).response;
  }

  importCsv(csvData: string, groupCode: string, memberId: string): Observable<{ created: number; updated: number; errors: number; total: number; errorDetails?: string[] }> {
    return this.http.post<{ created: number; updated: number; errors: number; total: number }>("/api/parishes/import", {csvData, groupCode, memberId});
  }
}
