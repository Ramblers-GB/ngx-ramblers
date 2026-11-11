import { inject, Injectable, OnDestroy } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { isEqual, isNumber } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { FileNameData } from "../../models/aws-object.model";
import { MapMarker, MapRoute, PageContent } from "../../models/content-text.model";
import { UIDateFormat } from "../../models/date-format.model";
import { ExtendedGroupEvent } from "../../models/group-event.model";
import {
  RouteFollowPayload,
  RouteFollowPoint,
  RouteFollowSession,
  RouteFollowSource
} from "../../models/route-follow.model";
import { generateUid } from "../../functions/numbers";
import { StoredValue } from "../../models/ui-actions.model";
import { DateUtilsService } from "../date-utils.service";
import { Logger, LoggerFactory } from "../logger-factory.service";
import { PageContentService } from "../page-content.service";
import { UiActionsService } from "../ui-actions.service";
import { WalksAndEventsService } from "../walks-and-events/walks-and-events.service";
import { WalkGpxService } from "../walks/walk-gpx.service";
import { RouteFollowCacheService } from "./route-follow-cache.service";
import { RouteFollowPayloadService } from "./route-follow-payload.service";
import { OsMapsExportService } from "./os-maps-export.service";
import { escapeHtml, toSlug } from "../../functions/strings";

interface QueuedWebsiteSave {
  payload: RouteFollowPayload;
  points: RouteFollowPoint[];
  asNew: boolean;
  saveAsNewRecordingId: string | null;
}

@Injectable({
  providedIn: "root"
})
export class RouteFollowSaveService implements OnDestroy {
  private dateUtils = inject(DateUtilsService);
  private walkGpx = inject(WalkGpxService);
  private walksAndEvents = inject(WalksAndEventsService);
  private pageContent = inject(PageContentService);
  private payloadService = inject(RouteFollowPayloadService);
  private osMapsExport = inject(OsMapsExportService);
  private uiActions = inject(UiActionsService);
  private followCache = inject(RouteFollowCacheService);
  private logger = inject(LoggerFactory).createLogger("RouteFollowSaveService", NgxLoggerLevel.ERROR);
  private queued: QueuedWebsiteSave | null = null;
  private flushing = false;
  private followScreenOpen = false;
  private online = () => void this.flushQueuedWebsiteSave();

  constructor() {
    window.addEventListener("online", this.online);
  }

  ngOnDestroy(): void {
    window.removeEventListener("online", this.online);
  }

  setFollowScreenOpen(open: boolean): void {
    this.followScreenOpen = open;
  }

  queueWebsiteSave(payload: RouteFollowPayload, points: RouteFollowPoint[], asNew = false, saveAsNewRecordingId: string | null = null): void {
    this.queued = JSON.parse(JSON.stringify({payload, points, asNew, saveAsNewRecordingId}));
    void this.flushQueuedWebsiteSave();
  }

  clearQueuedWebsiteSave(): void {
    this.queued = null;
  }

  async flushQueuedWebsiteSave(): Promise<boolean> {
    const job = this.queued || this.jobFromSession();
    if (!job || this.flushing || this.followScreenOpen || !navigator.onLine) {
      return false;
    } else {
      this.flushing = true;
      const inFlight = job;
      this.queued = job;
      try {
        const saved = job.asNew
          ? await this.saveAsNew(job.payload, job.points, job.saveAsNewRecordingId || generateUid())
          : job.payload.source === RouteFollowSource.RECORDING
            ? await this.saveStandalone(job.payload, job.points)
            : {...job.payload, points: job.points, gpxFile: await this.save(job.payload, job.points)};
        try {
          await this.followCache.savePayload(saved);
        } catch (error) {
          this.logger.warn("Queued website save could not be cached locally", error);
        }
        this.completeQueuedSave(inFlight);
        return true;
      } catch (error) {
        this.logger.error("Queued website save failed", error);
        return false;
      } finally {
        this.flushing = false;
      }
    }
  }

  private completeQueuedSave(inFlight: QueuedWebsiteSave): void {
    if (this.queued === inFlight) {
      this.queued = null;
    }
    if (this.sessionMatchesJob(inFlight)) {
      this.clearPendingSession();
    }
  }

  private sessionMatchesJob(job: QueuedWebsiteSave): boolean {
    try {
      if (!this.uiActions.itemExistsFor(StoredValue.FOLLOW_SESSION)) {
        return false;
      } else {
        const session = this.uiActions.initialObjectValueFor<RouteFollowSession>(StoredValue.FOLLOW_SESSION, null);
        const points = session?.recordedPoints || [];
        return !!session?.pendingNetworkSave
          && !!session.payload
          && !!session.pendingSaveAsNew === job.asNew
          && (session.saveAsNewRecordingId || null) === job.saveAsNewRecordingId
          && isEqual(session.payload, job.payload)
          && isEqual(points, job.points);
      }
    } catch (error) {
      this.logger.warn("Queued website save session unavailable", error);
      return false;
    }
  }

  private jobFromSession(): QueuedWebsiteSave | null {
    try {
      if (!this.uiActions.itemExistsFor(StoredValue.FOLLOW_SESSION)) {
        return null;
      } else {
        const session = this.uiActions.initialObjectValueFor<RouteFollowSession>(StoredValue.FOLLOW_SESSION, null);
        const points = session?.recordedPoints || [];
        if (session?.pendingNetworkSave && session.payload && points.length >= 2) {
          return {payload: session.payload, points, asNew: !!session.pendingSaveAsNew, saveAsNewRecordingId: session.saveAsNewRecordingId || null};
        } else {
          return null;
        }
      }
    } catch (error) {
      this.logger.warn("Queued website save session unavailable", error);
      return null;
    }
  }

  private clearPendingSession(): void {
    this.uiActions.removeItemFor(StoredValue.FOLLOW_SESSION);
  }

  canPersist(payload: RouteFollowPayload | null): boolean {
    if (!payload) {
      return false;
    } else if (payload.source === RouteFollowSource.RECORDING) {
      return !!payload.recordingId;
    } else if (payload.source === RouteFollowSource.WALK) {
      return !!payload.walkId;
    } else if (payload.source === RouteFollowSource.PAGE) {
      return !!payload.path;
    } else if (payload.source === RouteFollowSource.OS_MAPS) {
      return !!payload.osMapsRouteId;
    } else {
      return false;
    }
  }

  pointsToGpx(points: RouteFollowPoint[], name: string, description = ""): string {
    const stamp = points[0]?.recordedAt ? this.dateUtils.isoDateTime(points[0].recordedAt) : this.dateUtils.isoDateTimeNow();
    const trackPoints = points.map((point, index) => {
      const elevation = isNumber(point.elevation) ? point.elevation : 0;
      return `${index > 0 && point.breakBefore ? "    </trkseg>\n    <trkseg>\n" : ""}      <trkpt lat="${point.latitude}" lon="${point.longitude}">
        <ele>${elevation}</ele>${point.recordedAt ? `
        <time>${this.dateUtils.isoDateTime(point.recordedAt)}</time>` : ""}
      </trkpt>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ngx-ramblers" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeHtml(name)}</name>
    <desc>${escapeHtml(description)}</desc>
    <time>${stamp}</time>
  </metadata>
  <trk>
    <name>${escapeHtml(name)}</name>
    <type>hiking</type>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
  }

  async saveStandalone(payload: RouteFollowPayload, points: RouteFollowPoint[]): Promise<RouteFollowPayload> {
    if (!payload.recordingId || !payload.title.trim() || points.length < 2) {
      throw new Error("Give the recording a name and record at least two points before saving.");
    } else {
      const imported = await firstValueFrom(this.walkGpx.importGpxFile(this.gpxFile(payload, points), payload.title, payload.description || "", payload.recordingId));
      if (!imported.routeId) {
        throw new Error("The saved route did not return an identifier. Your recording is kept for retry.");
      } else {
        const saved = {
          ...payload,
          recordingId: null,
          source: RouteFollowSource.OS_MAPS,
          osMapsRouteId: imported.routeId,
          routeNumber: imported.number || null,
          gpxFile: imported.gpxFile,
          points,
          title: payload.title.trim(),
          description: payload.description || "",
          totalMetres: imported.gpxFile.distanceMetres || 0,
          createdDate: imported.gpxFile.createdDate ?? payload.createdDate,
          createdBy: imported.gpxFile.createdBy ?? payload.createdBy,
          createdByName: imported.gpxFile.createdByName ?? payload.createdByName,
          updatedDate: imported.gpxFile.updatedDate ?? payload.updatedDate,
          updatedBy: imported.gpxFile.updatedBy ?? payload.updatedBy,
          updatedByName: imported.gpxFile.updatedByName ?? payload.updatedByName
        };
        await this.attachToOsMapsRoute(imported.routeId, null, saved, true);
        return saved;
      }
    }
  }

  async saveAsNew(payload: RouteFollowPayload, points: RouteFollowPoint[], recordingId: string): Promise<RouteFollowPayload> {
    const copy = {
      ...this.payloadService.recordingPayload(recordingId),
      title: payload.title,
      description: payload.description,
      provider: payload.provider,
      osStyle: payload.osStyle,
      color: payload.color,
      weight: payload.weight,
      opacity: payload.opacity,
      visibility: payload.visibility,
      waypoints: payload.waypoints,
      guide: payload.guide
    };
    return this.saveStandalone(copy, points);
  }

  async save(payload: RouteFollowPayload, points: RouteFollowPoint[]): Promise<FileNameData> {
    if (points.length < 2) {
      throw new Error("A route needs at least two points before it can be saved.");
    } else {
      const file = this.gpxFile(payload, points);
      const uploaded = await firstValueFrom(this.walkGpx.uploadGpxFile(file, payload.title.trim()));
      const gpxFile = {...uploaded.gpxFile, title: payload.title.trim(), description: payload.description || ""};
      const persistedFile = payload.source === RouteFollowSource.PAGE && payload.path
        ? await this.savePageRoute(payload, file, gpxFile)
        : gpxFile;
      if (payload.source === RouteFollowSource.WALK && payload.walkId) {
        await this.attachToWalk(payload.walkId, gpxFile, payload);
      } else if (payload.source === RouteFollowSource.OS_MAPS && payload.osMapsRouteId) {
        await this.attachToOsMapsRoute(payload.osMapsRouteId, gpxFile, payload, true);
      } else if (payload.source !== RouteFollowSource.PAGE || !payload.path) {
        throw new Error("This route cannot be saved back to the site.");
      }
      return this.preserveCreationAudit(payload, persistedFile);
    }
  }

  private async savePageRoute(payload: RouteFollowPayload, file: File, gpxFile: FileNameData): Promise<FileNameData> {
    const page = await this.pageContent.findByPath(payload.path);
    const row = this.payloadService.followableRow(page, payload.routeId) || this.payloadService.firstMapRow(page);
    const route = payload.routeId ? row?.map?.routes?.find(item => item.id === payload.routeId) : row?.map?.routes?.[0];
    const existingId = payload.osMapsRouteId || route?.osMapsRouteId;
    const imported = existingId ? null : await firstValueFrom(this.walkGpx.importGpxFile(file, payload.title.trim()));
    const routeId = existingId || imported.routeId;
    const libraryFile = imported?.gpxFile ? {...imported.gpxFile, title: payload.title.trim(), description: payload.description || ""} : gpxFile;
    await this.attachToOsMapsRoute(routeId, libraryFile, payload, true);
    await this.attachToPage(payload.path, payload.routeId, payload.title, libraryFile, {...payload, osMapsRouteId: routeId});
    return libraryFile;
  }

  async saveStyle(payload: RouteFollowPayload): Promise<void> {
    if (payload.source === RouteFollowSource.WALK && payload.walkId) {
      const walk: ExtendedGroupEvent = await this.walksAndEvents.queryById(payload.walkId);
      this.applyStyleToWalk(walk, payload);
      await this.walksAndEvents.createOrUpdate(walk);
    } else if (payload.source === RouteFollowSource.PAGE && payload.path) {
      await this.attachToPage(payload.path, payload.routeId, payload.title, null, payload);
    } else if (payload.source === RouteFollowSource.OS_MAPS && payload.osMapsRouteId) {
      await this.attachToOsMapsRoute(payload.osMapsRouteId, null, payload);
    } else {
      throw new Error("This route style cannot be saved back to the site.");
    }
  }

  private async attachToWalk(walkId: string, gpxFile: FileNameData, payload: RouteFollowPayload): Promise<void> {
    const walk: ExtendedGroupEvent = await this.walksAndEvents.queryById(walkId);
    walk.fields.gpxFile = this.preserveCreationAudit(walk.fields.gpxFile, gpxFile);
    walk.fields.routeWaypoints = payload.waypoints || [];
    this.applyStyleToWalk(walk, payload);
    await this.walksAndEvents.createOrUpdate(walk);
  }

  private async attachToOsMapsRoute(routeId: string, gpxFile: FileNameData | null, payload: RouteFollowPayload, persistWaypoints = false): Promise<void> {
    await this.osMapsExport.saveImportedRoute(routeId, {
      gpxFile,
      color: payload.color,
      weight: payload.weight,
      opacity: payload.opacity,
      visibility: payload.visibility || null,
      difficulty: payload.guide?.difficulty || null,
      ...(persistWaypoints ? {waypoints: payload.waypoints || []} : {})
    });
  }

  private applyStyleToWalk(walk: ExtendedGroupEvent, payload: RouteFollowPayload): void {
    walk.fields.routeColor = payload.color;
    walk.fields.routeWeight = payload.weight;
    walk.fields.routeOpacity = payload.opacity;
  }

  private async attachToPage(path: string, routeId: string | null, title: string, gpxFile: FileNameData | null, payload: RouteFollowPayload): Promise<void> {
    const page: PageContent = await this.pageContent.findByPath(path);
    const row = this.payloadService.followableRow(page, routeId) || this.payloadService.firstMapRow(page);
    if (!row?.map) {
      throw new Error("This page does not have a map that can hold a route.");
    } else {
      row.map.routes = this.updatedRoutes(row.map.routes || [], routeId, title, gpxFile, payload);
      if (gpxFile) {
        row.map.markers = (payload.waypoints || []) as MapMarker[];
        if (row.routeGuide) {
          row.routeGuide.title = title;
        }
      }
      await this.pageContent.createOrUpdate(page);
    }
  }

  private updatedRoutes(routes: MapRoute[], routeId: string | null, title: string, gpxFile: FileNameData | null, payload: RouteFollowPayload): MapRoute[] {
    const matched = routeId ? routes.find(route => route.id === routeId) : routes[0];
    if (matched) {
      return routes.map(route => {
        if (route.id === matched.id) {
          const next = {
            ...route,
            color: payload.color,
            weight: payload.weight,
            opacity: payload.opacity,
            visible: route.visible !== false,
            osMapsRouteId: payload.osMapsRouteId || route.osMapsRouteId
          };
          return gpxFile ? {...next, name: title, gpxFile: this.preserveCreationAudit(route.gpxFile, gpxFile)} : next;
        } else {
          return route;
        }
      });
    } else {
      return [...routes, {
        id: generateUid(),
        name: title || "Recorded route",
        osMapsRouteId: payload.osMapsRouteId || null,
        visible: true,
        color: payload.color,
        weight: payload.weight,
        opacity: payload.opacity,
        ...(gpxFile ? {gpxFile} : {})
      }];
    }
  }

  private preserveCreationAudit(existing: FileNameData | null, uploaded: FileNameData): FileNameData {
    return existing ? {...uploaded, createdDate: existing.createdDate || null,
      createdBy: existing.createdBy || null, createdByName: existing.createdByName || null} : uploaded;
  }

  private gpxFile(payload: RouteFollowPayload, points: RouteFollowPoint[]): File {
    const stamp = this.dateUtils.asString(this.dateUtils.dateTimeNow(), undefined, UIDateFormat.FILE_TIMESTAMP_COMPACT);
    const named = toSlug(payload.title || "") || payload.walkId || payload.path?.split("/").filter(item => item).pop() || "route";
    const safe = named.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const name = `${safe || "route"}-${stamp}.gpx`;
    return new File([this.pointsToGpx(points, payload.title || "Recorded route", payload.description || "")], name, {type: "application/gpx+xml"});
  }

}
