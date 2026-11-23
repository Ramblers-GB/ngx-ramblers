import { TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";
import { RouteFollowMode, RouteFollowPoint, RouteFollowProgress } from "../../models/route-follow.model";
import { StoredValue } from "../../models/ui-actions.model";
import { UiActionsService } from "../ui-actions.service";
import { LoggerFactory } from "../logger-factory.service";
import { RouteFollowService } from "./route-follow.service";
import { RouteRecordingReturnService } from "./route-recording-return.service";
import { DateUtilsService } from "../date-utils.service";
import { ROUTE_FOLLOW_RETURN_MAX_AGE_MS } from "../../models/route-follow.model";

const NOW = 1795500000000;

describe("RouteRecordingReturnService", () => {
  const progress = new BehaviorSubject<RouteFollowProgress>({mode: RouteFollowMode.RECORDING} as RouteFollowProgress);
  const track: {points: RouteFollowPoint[]} = {points: [{latitude: 51, longitude: 1}]};
  const followService = {
    progress$: progress,
    progress: () => progress.value,
    trackPoints: () => track.points,
    pausedMode: () => RouteFollowMode.RECORDING,
    recordingSession: () => true,
    resumeWatchIfLive: vi.fn()
  };
  const uiActions = {
    itemExistsFor: vi.fn(() => true),
    initialObjectValueFor: vi.fn(() => ({walkId: "fictional-walk", mode: RouteFollowMode.RECORDING, recordedPoints: []})),
    saveValueFor: vi.fn(() => true)
  };

  beforeEach(() => {
    vi.clearAllMocks();
    track.points = [{latitude: 51, longitude: 1}];
    progress.next({mode: RouteFollowMode.RECORDING} as RouteFollowProgress);
    TestBed.configureTestingModule({providers: [
      {provide: RouteFollowService, useValue: followService},
      {provide: UiActionsService, useValue: uiActions},
      {provide: LoggerFactory, useValue: {createLogger: () => ({warn: vi.fn(), error: vi.fn()})}},
      {provide: DateUtilsService, useValue: {dateTimeNowAsValue: () => NOW}}
    ]});
  });

  it("offers a way back and keeps saving points recorded after leaving the map", () => {
    const service = TestBed.inject(RouteRecordingReturnService);
    service.leave("/app/route?record-route=abc");
    expect(service.returnTo()).toEqual({url: "/app/route?record-route=abc", recording: true});
    expect(uiActions.saveValueFor).not.toHaveBeenCalled();
    track.points = [...track.points, {latitude: 51.001, longitude: 1.001}];
    progress.next({mode: RouteFollowMode.RECORDING} as RouteFollowProgress);
    expect(uiActions.saveValueFor).toHaveBeenCalledWith(StoredValue.FOLLOW_SESSION,
      expect.objectContaining({walkId: "fictional-walk", recordedPoints: track.points}));
    service.returned();
  });

  it("forgets the way back once the recording is no longer running", () => {
    const service = TestBed.inject(RouteRecordingReturnService);
    service.leave("/app/route?record-route=abc");
    progress.next({mode: RouteFollowMode.IDLE} as RouteFollowProgress);
    expect(service.returnTo()).toBeNull();
  });

  it("forgets the way back when the map is opened again", () => {
    const service = TestBed.inject(RouteRecordingReturnService);
    service.leave("/app/route?record-route=abc");
    service.returned();
    expect(service.returnTo()).toBeNull();
    expect(uiActions.saveValueFor).toHaveBeenCalledTimes(1);
  });

  it.each([
    [RouteFollowMode.RECORDING, true, "/app/route?record-route=abc"],
    [RouteFollowMode.FOLLOWING, false, "/app/route?walk-id=fictional-walk"]
  ])("offers a way back to a %s session saved before the app restarted", (mode, recording, url) => {
    uiActions.initialObjectValueFor.mockReturnValueOnce(recording
      ? {recordingId: "abc", mode} as never
      : {walkId: "fictional-walk", mode, savedAt: NOW - 60 * 1000} as never);
    const service = TestBed.inject(RouteRecordingReturnService);
    service.offerSavedSession();
    expect(service.returnTo()).toEqual({url, recording});
  });

  it("does not offer a way back to a followed walk left long ago", () => {
    uiActions.initialObjectValueFor.mockReturnValueOnce({walkId: "fictional-walk", mode: RouteFollowMode.FOLLOWING, savedAt: NOW - ROUTE_FOLLOW_RETURN_MAX_AGE_MS - 1} as never);
    const service = TestBed.inject(RouteRecordingReturnService);
    service.offerSavedSession();
    expect(service.returnTo()).toBeNull();
  });

  it("still offers a way back to an old recording, so its points are not lost", () => {
    uiActions.initialObjectValueFor.mockReturnValueOnce({recordingId: "abc", mode: RouteFollowMode.RECORDING} as never);
    const service = TestBed.inject(RouteRecordingReturnService);
    service.offerSavedSession();
    expect(service.returnTo()).toEqual({url: "/app/route?record-route=abc", recording: true});
  });

  it("offers nothing when no live session is saved", () => {
    uiActions.itemExistsFor.mockReturnValueOnce(false);
    const service = TestBed.inject(RouteRecordingReturnService);
    service.offerSavedSession();
    expect(service.returnTo()).toBeNull();
  });
});
