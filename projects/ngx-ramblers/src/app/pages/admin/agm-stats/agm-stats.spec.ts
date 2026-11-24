import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, Router } from "@angular/router";
import { DateTime } from "luxon";
import { of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGMStatsComponent } from "./agm-stats";
import { AgmStatsPreset } from "../../../models/agm-stats.model";
import { AGMStatsResponse, YearComparison } from "../../../models/group-event.model";
import { CommitteeFile, CommitteeFileMeetingRole } from "../../../models/committee.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { SITE_TIME_ZONE } from "../../../models/locale.model";
import { DateUtilsService } from "../../../services/date-utils.service";
import { NumberUtilsService } from "../../../services/number-utils.service";
import { StringUtilsService } from "../../../services/string-utils.service";
import { LoggerFactory } from "../../../services/logger-factory.service";
import { AGMStatsService } from "../../../services/agm-stats.service";
import { CommitteeConfigService } from "../../../services/committee/commitee-config.service";
import { CommitteeFileService } from "../../../services/committee/committee-file.service";
import { UiActionsService } from "../../../services/ui-actions.service";
import { PageContentService } from "../../../services/page-content.service";
import { FileUploadService } from "../../../services/file-upload.service";
import { UrlService } from "../../../services/url.service";
import { MemberLoginService } from "../../../services/member/member-login.service";
import { EmailComposerSendService } from "../../../services/email-composer/email-composer-send.service";
import { GroupEventDisplayService } from "../../group-events/group-event-display.service";

const date = (iso: string) => DateTime.fromISO(iso, {zone: SITE_TIME_ZONE}).toMillis();
const previous = date("2029-11-18");
const current = date("2030-11-19");
const next = date("2031-11-20T19:00");
const minutes = date("2030-12-03");
const files: CommitteeFile[] = [
  {eventDate: previous, fileType: "AGM Agenda"},
  {eventDate: current, fileType: "AGM Agenda"},
  {eventDate: minutes, fileType: "AGM Minutes"},
  {eventDate: next, fileType: "AGM Agenda"},
  {eventDate: date("2031-05-15"), fileType: "Committee Agenda"},
  {eventDate: date("2031-08-14"), fileType: "Committee Agenda"}
];
const fileTypes = [
  {description: "AGM Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "AGM"},
  {description: "AGM Minutes", meetingRole: CommitteeFileMeetingRole.MINUTES, meetingCategory: "AGM"},
  {description: "Committee Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "Committee Meeting"}
];
const comparison = (from: number, to: number, totalWalks: number) => ({
  year: DateTime.fromMillis(from, {zone: SITE_TIME_ZONE}).year,
  periodFrom: from,
  periodTo: to,
  walks: {totalWalks, allLeaders: [], newLeadersList: []},
  socials: {totalSocials: 0, uniqueOrganisers: 0},
  membership: {totalMembers: 0, newJoiners: 0, leavers: 0}
} as YearComparison);
const response = (): AGMStatsResponse => {
  const priorYear = comparison(previous, current - 1, 70);
  const currentYear = comparison(current, next, 65);
  return {previousYear: priorYear, currentYear, twoYearsAgo: null, earliestDate: previous, yearlyStats: [priorYear, currentYear]};
};

function setup(queryParams: Record<string, string> = {
  [StoredValue.DATE_FROM]: "2030-12-03",
  [StoredValue.DATE_TO]: "2031-11-20",
  [StoredValue.DATE_RANGE_PRESET]: AgmStatsPreset.BETWEEN_COMMITTEE_EVENTS
}) {
  const requests = new Subject<AGMStatsResponse>();
  const statsService = {agmStats: vi.fn(() => requests.asObservable())};
  const navigate = vi.fn().mockResolvedValue(true);
  const all = vi.fn().mockResolvedValue(files);
  TestBed.configureTestingModule({providers: [
    DateUtilsService,
    {provide: NumberUtilsService, useValue: {}},
    {provide: StringUtilsService, useValue: {}},
    {provide: LoggerFactory, useValue: {createLogger: () => ({info: vi.fn(), error: vi.fn()})}},
    {provide: AGMStatsService, useValue: statsService},
    {provide: CommitteeFileService, useValue: {all}},
    {provide: CommitteeConfigService, useValue: {committeeConfigEvents: () => of({roles: [], fileTypes})}},
    {provide: UiActionsService, useValue: {initialValueFor: (_key: StoredValue, fallback: unknown) => fallback, saveValueFor: vi.fn()}},
    {provide: ActivatedRoute, useValue: {snapshot: {url: [], queryParamMap: convertToParamMap(queryParams)}}},
    {provide: Router, useValue: {navigate}},
    {provide: PageContentService, useValue: {findByPath: vi.fn()}},
    {provide: MemberLoginService, useValue: {loggedInMember: () => null}},
    ...[FileUploadService, UrlService, EmailComposerSendService, GroupEventDisplayService].map(provide => ({provide, useValue: {}}))
  ]});
  const component = TestBed.runInInjectionContext(() => new AGMStatsComponent());
  component.ngOnInit();
  return {component, statsService, requests, navigate, all};
}

describe("AGM statistics reporting", () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it("restores an old minutes URL to the agenda and requests two full reporting periods", async () => {
    const {component, statsService, navigate} = setup();
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    expect(component.fromCommitteeEventDate).toBe(current);
    expect(component.committeeEventCategory).toBe("AGM");
    expect(component.filteredCommitteeEvents().every(event => event.meetingCategory === "AGM")).toBe(true);
    expect(statsService.agmStats.mock.calls[0]).toEqual([
      current,
      DateTime.fromMillis(next, {zone: SITE_TIME_ZONE}).endOf("day").toMillis(),
      [
        {fromDate: previous, toDate: current - 1},
        {fromDate: current, toDate: DateTime.fromMillis(next, {zone: SITE_TIME_ZONE}).endOf("day").toMillis()}
      ]
    ]);
    expect(navigate.mock.calls.some(([, options]) => options.queryParams[StoredValue.DATE_FROM] === "2030-11-19")).toBe(true);
    component.ngOnDestroy();
  });

  it("keeps the previous comparison in charts even though it predates the selected range", async () => {
    const {component, statsService, requests} = setup();
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    requests.next(response());
    expect(component.walkChartData.labels).toHaveLength(2);
    expect(component.walkChartData.datasets.find(dataset => dataset.label === "Total Walks on Programme")?.data).toEqual([70, 65]);
    expect(component.yearsInRange()).toHaveLength(2);
    component.ngOnDestroy();
  });

  it("keeps selected meeting dates even when recorded activity starts later", async () => {
    const {component, statsService, requests} = setup();
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    requests.next({...response(), earliestDate: date("2031-01-01")});
    expect(component.fromDate).toBe(current);
    expect(component.fromCommitteeEventDate).toBe(current);
    component.ngOnDestroy();
  });

  it("switches meeting type without leaving AGM dates in the committee selectors", async () => {
    const {component, statsService} = setup();
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    component.committeeEventCategory = "Committee Meeting";
    component.onCommitteeEventCategoryChange();
    expect(component.filteredCommitteeEvents().every(event => event.meetingCategory === "Committee Meeting")).toBe(true);
    expect(component.fromCommitteeEventDate).toBe(date("2031-05-15"));
    expect(component.toCommitteeEventDate).toBe(date("2031-08-14"));
    expect(statsService.agmStats).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it("rejects a removed bookmarked meeting and does not fall back to a fabricated period", async () => {
    const {component, statsService} = setup({
      [StoredValue.DATE_FROM]: "2030-12-10",
      [StoredValue.DATE_TO]: "2031-11-20",
      [StoredValue.DATE_RANGE_PRESET]: AgmStatsPreset.BETWEEN_COMMITTEE_EVENTS
    });
    await vi.waitFor(() => expect(component.committeeEventsLoading).toBe(false));
    expect(statsService.agmStats).not.toHaveBeenCalled();
    expect(component.error).toContain("starting committee event could not be found");
    expect(component.stats).toBeNull();
    component.ngOnDestroy();
  });

  it("cancels pending figures when a new selection is invalid", async () => {
    const {component, statsService, requests} = setup();
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    component.toCommitteeEventDate = current;
    component.onCommitteeEventChange();
    requests.next(response());
    expect(component.stats).toBeNull();
    expect(component.error).toContain("different years");
    expect(component.loading).toBe(false);
    component.ngOnDestroy();
  });

  it("restores the meeting type when different categories meet on the same day", async () => {
    const {component, all, statsService, navigate} = setup({
      [StoredValue.DATE_FROM]: "2030-11-19",
      [StoredValue.DATE_TO]: "2031-08-14",
      [StoredValue.MEETING_TYPE]: "Committee Meeting",
      [StoredValue.DATE_RANGE_PRESET]: AgmStatsPreset.BETWEEN_COMMITTEE_EVENTS
    });
    all.mockResolvedValue([...files, {eventDate: current, fileType: "Committee Agenda"}]);
    await vi.waitFor(() => expect(statsService.agmStats).toHaveBeenCalledTimes(1));
    expect(component.committeeEventCategory).toBe("Committee Meeting");
    expect(component.filteredCommitteeEvents().every(event => event.meetingCategory === "Committee Meeting")).toBe(true);
    expect(navigate.mock.calls.some(([, options]) => options.queryParams[StoredValue.MEETING_TYPE] === "Committee Meeting")).toBe(true);
    component.ngOnDestroy();
  });

  it("does not request statistics if committee metadata fails to load", async () => {
    const {component, all, statsService} = setup();
    all.mockRejectedValue(new Error("Unavailable"));
    await vi.waitFor(() => expect(component.committeeEventsLoading).toBe(false));
    expect(statsService.agmStats).not.toHaveBeenCalled();
    expect(component.error).toBe("The committee events could not be loaded. Reload the page to try again.");
    component.ngOnDestroy();
  });
});
