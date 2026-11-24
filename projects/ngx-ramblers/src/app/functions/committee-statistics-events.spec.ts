import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { CommitteeFile, CommitteeFileMeetingRole, CommitteeFileType, CommitteeMeetingFormat } from "../models/committee.model";
import { CommitteeStatisticsEvent } from "../models/agm-stats.model";
import { SITE_TIME_ZONE } from "../models/locale.model";
import { committeeEventComparisonPeriods, committeeStatisticsEventMatching, committeeStatisticsEvents, latestAgmReportingRange, previousCommitteeEventDate } from "./committee-statistics-events";

const fileTypes: CommitteeFileType[] = [
  {description: "Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "Committee Meeting"},
  {description: "Minutes", meetingRole: CommitteeFileMeetingRole.MINUTES, meetingCategory: "Committee Meeting"},
  {description: "AGM Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "AGM"},
  {description: "AGM Minutes", meetingRole: CommitteeFileMeetingRole.MINUTES, meetingCategory: "AGM"},
  {description: "Other document"}
];
const millis = (iso: string) => DateTime.fromISO(iso, {zone: SITE_TIME_ZONE}).toMillis();
const start = (value: number) => DateTime.fromMillis(value, {zone: SITE_TIME_ZONE}).startOf("day").toMillis();
const end = (value: number) => DateTime.fromMillis(value, {zone: SITE_TIME_ZONE}).endOf("day").toMillis();
const previousAgm = millis("2029-11-18");
const currentAgm = millis("2030-11-19T19:00");
const minutesDate = millis("2030-12-03");
const nextAgm = millis("2031-11-20T19:00");
const files: CommitteeFile[] = [
  {eventDate: minutesDate, fileType: "AGM Minutes"},
  {eventDate: nextAgm, fileType: "AGM Agenda"},
  {eventDate: currentAgm, fileType: "AGM Agenda"},
  {eventDate: previousAgm, fileType: "AGM Minutes"},
  {eventDate: millis("2031-08-12"), fileType: "Agenda"},
  {eventDate: millis("2030-11-19"), fileType: "Minutes"}
];
const events = () => committeeStatisticsEvents(files, fileTypes, value => `date-${value}`);
const event = (date: number, meetingCategory = "AGM"): CommitteeStatisticsEvent => ({date, meetingCategory, label: `date-${date}`});

describe("committeeStatisticsEvents", () => {
  it("uses the agenda date for an annual AGM even when minutes are filed later", () => {
    const agms = events().filter(item => item.meetingCategory === "AGM");
    expect(agms.map(item => item.date)).toEqual([nextAgm, currentAgm, previousAgm]);
    expect(agms[1].sourceDates).toEqual([minutesDate, currentAgm]);
    expect(agms.every(item => !item.ambiguous)).toBe(true);
    expect(committeeStatisticsEvents([...files].reverse(), fileTypes, value => `date-${value}`).map(item => item.date)).toEqual(events().map(item => item.date));
  });

  it("keeps different meeting categories on the same day separate", () => {
    const sameDay = events().filter(item => start(item.date) === start(currentAgm));
    expect(sameDay.map(item => item.meetingCategory)).toEqual(["AGM", "Committee Meeting"]);
  });

  it("collapses copies of an agenda and minutes on the same local day", () => {
    const result = committeeStatisticsEvents([
      {eventDate: millis("2030-07-15T23:30:00Z"), fileType: "Agenda"},
      {eventDate: millis("2030-07-16T19:00"), fileType: "Minutes"},
      {eventDate: millis("2030-07-16T00:30"), fileType: "Agenda"}
    ], fileTypes, value => `date-${value}`);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe(millis("2030-07-16T00:30"));
  });

  it("ignores non-meeting documents, ad-hoc calls and invalid dates", () => {
    const result = committeeStatisticsEvents([
      {eventDate: currentAgm, fileType: "Other document"},
      {eventDate: currentAgm, fileType: "", meeting: {format: CommitteeMeetingFormat.ONLINE, title: "Meeting"}},
      {eventDate: NaN, fileType: "AGM Agenda"},
      {fileType: "AGM Agenda"}
    ], fileTypes, value => `date-${value}`);
    expect(result).toEqual([]);
  });

  it("flags conflicting agenda dates rather than guessing which AGM took place", () => {
    const result = committeeStatisticsEvents([
      ...files, {eventDate: millis("2030-11-25"), fileType: "AGM Agenda"}
    ], fileTypes, value => `date-${value}`);
    expect(result.find(item => item.date === millis("2030-11-25"))?.ambiguous).toBe(true);
    expect(() => committeeEventComparisonPeriods(millis("2030-11-25"), nextAgm, result, start)).toThrow("More than one AGM meeting date");
  });

  it("flags different minutes dates when no agenda establishes the annual meeting date", () => {
    const result = committeeStatisticsEvents([
      {eventDate: currentAgm, fileType: "AGM Minutes"},
      {eventDate: minutesDate, fileType: "AGM Minutes"}
    ], fileTypes, value => `date-${value}`);
    expect(result[0].ambiguous).toBe(true);
  });
});

describe("latestAgmReportingRange", () => {
  it("uses annual AGM dates, skipping committee meetings and separately dated minutes", () => {
    expect(latestAgmReportingRange(events())).toEqual({fromDate: currentAgm, toDate: nextAgm});
  });

  it("sorts unsorted input and never chooses two AGM documents from the same year", () => {
    expect(latestAgmReportingRange([event(currentAgm), event(minutesDate), event(nextAgm)])).toEqual({fromDate: minutesDate, toDate: nextAgm});
    expect(latestAgmReportingRange([event(currentAgm), event(minutesDate)])).toBeNull();
  });
});

describe("committeeEventComparisonPeriods", () => {
  it("compares full annual periods and counts the boundary day in only the current period", () => {
    expect(committeeEventComparisonPeriods(start(currentAgm), end(nextAgm), events(), start)).toEqual([
      {fromDate: start(previousAgm), toDate: start(currentAgm) - 1},
      {fromDate: start(currentAgm), toDate: end(nextAgm)}
    ]);
  });

  it("restores a bookmarked minutes date to its AGM agenda date", () => {
    expect(committeeStatisticsEventMatching(events(), start(minutesDate), start)?.date).toBe(currentAgm);
    expect(committeeEventComparisonPeriods(start(minutesDate), end(nextAgm), events(), start)).toEqual(
      committeeEventComparisonPeriods(start(currentAgm), end(nextAgm), events(), start)
    );
  });

  it("skips same-year AGM documents and sorts before finding the preceding year", () => {
    expect(previousCommitteeEventDate([event(previousAgm), event(currentAgm), event(minutesDate)], minutesDate, start, " agm ")).toBe(previousAgm);
  });

  it("compares ordinary committee meetings without imposing an annual interval", () => {
    const earlier = millis("2030-02-14");
    const from = millis("2030-05-16T19:00");
    const to = millis("2030-08-15T19:00");
    const meetings = [event(to, "Committee Meeting"), event(currentAgm), event(from, "Committee Meeting"), event(earlier, "Committee Meeting")];
    expect(committeeEventComparisonPeriods(start(from), end(to), meetings, start)).toEqual([
      {fromDate: earlier, toDate: start(from) - 1}, {fromDate: start(from), toDate: end(to)}
    ]);
    expect(previousCommitteeEventDate(meetings, from, start, "Committee Meeting")).toBe(earlier);
  });

  it("does not treat another time on the selected London day as a previous meeting", () => {
    const day = millis("2030-07-15T23:30:00Z");
    const earlier = millis("2030-04-16");
    expect(previousCommitteeEventDate([event(day, "Committee Meeting"), event(earlier, "Committee Meeting")], millis("2030-07-16T19:00"), start, "Committee Meeting")).toBe(earlier);
  });

  it("keeps a single period where there is no previous AGM", () => {
    expect(committeeEventComparisonPeriods(currentAgm, nextAgm, [event(currentAgm), event(nextAgm)], start)).toEqual([
      {fromDate: start(currentAgm), toDate: end(nextAgm)}
    ]);
  });

  it("rejects missing start meetings, mixed categories and same-year AGM comparisons", () => {
    expect(() => committeeEventComparisonPeriods(1, nextAgm, events(), start)).toThrow("starting committee event could not be found");
    expect(() => committeeEventComparisonPeriods(currentAgm, millis("2031-06-18"), events(), start)).toThrow("ending committee event could not be found");
    expect(() => committeeEventComparisonPeriods(currentAgm, millis("2031-08-12"), events(), start)).toThrow("same meeting type");
    expect(() => committeeEventComparisonPeriods(currentAgm, minutesDate, events(), start)).toThrow("different years");
  });

  it("rejects ambiguous dates in the previous comparison as well as the selected period", () => {
    const result = events().map(item => ({...item, ambiguous: item.date === previousAgm}));
    expect(() => committeeEventComparisonPeriods(currentAgm, nextAgm, result, start)).toThrow("More than one AGM meeting date");
  });

  it("allows an open-ended since-meeting range", () => {
    const today = millis("2031-06-18T10:00");
    expect(committeeEventComparisonPeriods(currentAgm, today, events(), start, false)[1]).toEqual({fromDate: start(currentAgm), toDate: end(today)});
  });
});
