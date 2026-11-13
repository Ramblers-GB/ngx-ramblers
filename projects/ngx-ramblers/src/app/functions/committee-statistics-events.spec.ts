import { describe, expect, it } from "vitest";
import { CommitteeFile, CommitteeFileMeetingRole, CommitteeFileType, CommitteeMeetingFormat } from "../models/committee.model";
import { committeeEventComparisonPeriods, committeeStatisticsEvents, latestAgmReportingRange, previousCommitteeEventDate } from "./committee-statistics-events";

const fileTypes: CommitteeFileType[] = [
  {description: "Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "Committee Meeting"},
  {description: "Minutes", meetingRole: CommitteeFileMeetingRole.MINUTES, meetingCategory: "Committee Meeting"},
  {description: "AGM Agenda", meetingRole: CommitteeFileMeetingRole.AGENDA, meetingCategory: "AGM"},
  {description: "Other document"}
];

describe("committeeStatisticsEvents", () => {
  it("returns meetings newest first, includes upcoming dates, and collapses files on the same event date", () => {
    const files = [
      {eventDate: 100, fileType: "Agenda"},
      {eventDate: 100, fileType: "Minutes"},
      {eventDate: 200, fileType: "AGM Agenda"},
      {eventDate: 400, fileType: "Agenda"},
      {eventDate: 150, fileType: "Other document"}
    ] as CommitteeFile[];
    expect(committeeStatisticsEvents(files, fileTypes, value => `date-${value}`)).toEqual([
      {date: 400, label: "Committee Meeting, date-400", meetingCategory: "Committee Meeting"},
      {date: 200, label: "AGM, date-200", meetingCategory: "AGM"},
      {date: 100, label: "Committee Meeting, date-100", meetingCategory: "Committee Meeting"}
    ]);
  });

  it("does not use an ad-hoc video call as a reporting period", () => {
    const files = [{
      eventDate: 100,
      fileType: "",
      meeting: {format: CommitteeMeetingFormat.ONLINE, title: "Ramblers meeting"}
    }] as CommitteeFile[];
    expect(committeeStatisticsEvents(files, fileTypes, value => `date-${value}`)).toEqual([]);
  });
});

describe("latestAgmReportingRange", () => {
  it("uses the two newest AGMs, skipping ordinary committee meetings", () => {
    expect(latestAgmReportingRange([
      {date: 400, label: "Upcoming AGM", meetingCategory: "AGM"},
      {date: 350, label: "November committee", meetingCategory: "Committee Meeting"},
      {date: 200, label: "Last AGM", meetingCategory: "AGM"},
      {date: 100, label: "AGM before that", meetingCategory: "AGM"}
    ])).toEqual({fromDate: 200, toDate: 400});
  });
});

describe("committeeEventComparisonPeriods", () => {

  it("compares an AGM range with the previous AGM, skipping ordinary committee meetings", () => {
    const events = [
      {date: 400, label: "Upcoming AGM", meetingCategory: "AGM"},
      {date: 350, label: "November committee", meetingCategory: "Committee Meeting"},
      {date: 300, label: "Last AGM", meetingCategory: "AGM"},
      {date: 200, label: "AGM before that", meetingCategory: "AGM"}
    ];
    expect(previousCommitteeEventDate(events, 300, value => value, "AGM")).toEqual(200);
    expect(committeeEventComparisonPeriods(300, 400, events)).toEqual([
      {fromDate: 200, toDate: 300},
      {fromDate: 300, toDate: 400}
    ]);
  });

  it("does not treat the same meeting as previous when it is stored a few hours before the selected day", () => {
    const startOfDay = (value: number) => Math.floor(value / 100);
    const events = [
      {date: 250, label: "May meeting at 23:00 the previous UTC day", meetingCategory: "Committee Meeting"},
      {date: 100, label: "February", meetingCategory: "Committee Meeting"}
    ];
    expect(previousCommitteeEventDate(events, 260, startOfDay)).toEqual(100);
    expect(committeeEventComparisonPeriods(250, 400, events, startOfDay)).toEqual([
      {fromDate: 100, toDate: 250},
      {fromDate: 250, toDate: 400}
    ]);
  });

  it("keeps a single period when there is no earlier meeting of the same type", () => {
    expect(committeeEventComparisonPeriods(100, 200, [{date: 100, label: "Only", meetingCategory: "AGM"}])).toEqual([
      {fromDate: 100, toDate: 200}
    ]);
  });
});
