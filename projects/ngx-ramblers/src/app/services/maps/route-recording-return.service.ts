import { inject, Injectable, NgZone } from "@angular/core";
import { Router } from "@angular/router";
import { BehaviorSubject, Subscription } from "rxjs";
import { NgxLoggerLevel } from "ngx-logger";
import { StoredValue } from "../../models/ui-actions.model";
import { isLiveFollowMode, ROUTE_FOLLOW_RETURN_MAX_AGE_MS, RouteFollowMode, RouteFollowReturn, RouteFollowSession } from "../../models/route-follow.model";
import { DateUtilsService } from "../date-utils.service";
import { followRouteLink, followRouteQuery } from "../../functions/route-follow-link";
import { UiActionsService } from "../ui-actions.service";
import { LoggerFactory } from "../logger-factory.service";
import { RouteFollowService } from "./route-follow.service";

@Injectable({providedIn: "root"})
export class RouteRecordingReturnService {
  private followService = inject(RouteFollowService);
  private uiActions = inject(UiActionsService);
  private dateUtils = inject(DateUtilsService);
  private router = inject(Router);
  private zone = inject(NgZone);
  private logger = inject(LoggerFactory).createLogger("RouteRecordingReturnService", NgxLoggerLevel.ERROR);
  private subscription: Subscription | null = null;
  private savedPointCount = -1;
  private returnSubject = new BehaviorSubject<RouteFollowReturn | null>(null);
  readonly return$ = this.returnSubject.asObservable();
  private readonly visibilityListener = () => this.zone.run(() => this.onVisibilityChange());

  returnTo(): RouteFollowReturn | null {
    return this.returnSubject.value;
  }

  leave(url: string): void {
    this.stopWatching();
    this.savedPointCount = this.followService.trackPoints().length;
    this.returnSubject.next({url, recording: this.followService.recordingSession()});
    this.subscription = this.followService.progress$.subscribe(progress => {
      if (progress.mode === RouteFollowMode.IDLE) {
        this.returned();
      } else {
        this.saveRecordedPoints();
      }
    });
    document.addEventListener("visibilitychange", this.visibilityListener);
  }

  offerSavedSession(): void {
    if (!this.returnSubject.value) {
      const session = this.storedSession();
      const recording = session?.mode === RouteFollowMode.RECORDING
        || (session?.mode === RouteFollowMode.PAUSED && session?.pausedFromMode === RouteFollowMode.RECORDING);
      const recent = (session?.savedAt || 0) >= this.dateUtils.dateTimeNowAsValue() - ROUTE_FOLLOW_RETURN_MAX_AGE_MS;
      if (session && isLiveFollowMode(session.mode) && (recording || recent)) {
        const url = this.router.serializeUrl(this.router.createUrlTree(followRouteLink(session), {queryParams: followRouteQuery(session)}));
        this.returnSubject.next({url, recording});
      }
    }
  }

  returned(): void {
    if (this.subscription) {
      this.saveRecordedPoints(true);
    }
    this.stopWatching();
    this.returnSubject.next(null);
  }

  private stopWatching(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    document.removeEventListener("visibilitychange", this.visibilityListener);
  }

  private onVisibilityChange(): void {
    if (document.visibilityState === "visible") {
      this.followService.resumeWatchIfLive();
    } else {
      this.saveRecordedPoints(true);
    }
  }

  private storedSession(): RouteFollowSession | null {
    try {
      return this.uiActions.itemExistsFor(StoredValue.FOLLOW_SESSION)
        ? this.uiActions.initialObjectValueFor<RouteFollowSession>(StoredValue.FOLLOW_SESSION, null)
        : null;
    } catch (error) {
      this.logger.warn("saved route session unavailable", error);
      return null;
    }
  }

  private saveRecordedPoints(force = false): void {
    const points = this.followService.trackPoints();
    if (force || points.length !== this.savedPointCount) {
      const stored = this.storedSession();
      if (stored) {
        const progress = this.followService.progress();
        const saved = this.uiActions.saveValueFor(StoredValue.FOLLOW_SESSION, {
          ...stored,
          mode: progress.mode,
          pausedFromMode: this.followService.pausedMode(),
          recordedPoints: points,
          progress,
          savedAt: this.dateUtils.dateTimeNowAsValue()
        });
        if (saved) {
          this.savedPointCount = points.length;
        } else {
          this.logger.warn("recording could not be saved on this device");
        }
      }
    }
  }
}
