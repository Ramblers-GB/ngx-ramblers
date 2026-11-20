import { inject, Injectable } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import { ROUTE_FOLLOW_PATH_TIMEOUT_MS, RouteFollowPoint } from "../../models/route-follow.model";
import { walkingPathFromResponse, walkingPathUrl } from "../../functions/walking-path";
import { Logger, LoggerFactory } from "../logger-factory.service";

@Injectable({providedIn: "root"})
export class WalkingPathService {
  private logger: Logger = inject(LoggerFactory).createLogger("WalkingPathService", NgxLoggerLevel.ERROR);

  async pathBetween(from: RouteFollowPoint, to: RouteFollowPoint): Promise<RouteFollowPoint[] | null> {
    try {
      const response = await fetch(walkingPathUrl(from, to), {signal: AbortSignal.timeout(ROUTE_FOLLOW_PATH_TIMEOUT_MS)});
      return response.ok ? walkingPathFromResponse(await response.json()) : null;
    } catch (error) {
      this.logger.error("pathBetween failed", error);
      return null;
    }
  }
}
