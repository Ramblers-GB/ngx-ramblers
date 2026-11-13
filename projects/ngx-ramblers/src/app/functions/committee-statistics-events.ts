import { CommitteeFile, CommitteeFileType, isMeetingFileType } from "../models/committee.model";
import { CommitteeStatisticsEvent } from "../models/agm-stats.model";
import { committeeMeetingHeading } from "./committee-meeting-agenda";
import { suggestedVideoMeetingTitle } from "./video-meeting-join";

export function committeeStatisticsEvents(
  files: CommitteeFile[],
  fileTypes: CommitteeFileType[],
  dateLabel: (value: number) => string
): CommitteeStatisticsEvent[] {
  const eventsByDate = (files || [])
    .filter(file => !!file.eventDate)
    .filter(file => isMeetingFileType(file.fileType, fileTypes))
    .reduce<Map<number, CommitteeStatisticsEvent>>((events, file) => {
      const existing = events.get(file.eventDate);
      const fileType = fileTypes.find(candidate => candidate.description === file.fileType);
      const heading = committeeMeetingHeading(
        file.meeting?.title || file.document?.title || file.fileNameData?.title || file.fileType || "",
        fileType?.meetingCategory
      );
      events.set(file.eventDate, existing || {
        date: file.eventDate,
        label: suggestedVideoMeetingTitle(heading, dateLabel(file.eventDate)),
        meetingCategory: fileType?.meetingCategory || ""
      });
      return events;
    }, new Map<number, CommitteeStatisticsEvent>());
  return [...eventsByDate.values()].sort((left, right) => right.date - left.date);
}

export function previousCommitteeEventDate(
  events: CommitteeStatisticsEvent[],
  selectedDate: number,
  dayValue: (value: number) => number = value => value,
  meetingCategory: string | null = null
): number | null {
  const selectedDay = dayValue(selectedDate);
  const wanted = (meetingCategory || "").toLowerCase();
  const previous = (events || []).find(event =>
    dayValue(event.date) < selectedDay
    && (!wanted || (event.meetingCategory || "").toLowerCase() === wanted)
  );
  return previous?.date || null;
}

export function latestAgmReportingRange(events: CommitteeStatisticsEvent[]): {fromDate: number; toDate: number} | null {
  const agms = (events || []).filter(event => (event.meetingCategory || "").toLowerCase() === "agm");
  if (agms.length >= 2) {
    return {fromDate: agms[1].date, toDate: agms[0].date};
  } else {
    return null;
  }
}

export function committeeEventComparisonPeriods(
  fromDate: number,
  toDate: number,
  events: CommitteeStatisticsEvent[],
  dayValue: (value: number) => number = value => value
): {fromDate: number; toDate: number}[] {
  const fromEvent = (events || []).find(event => dayValue(event.date) === dayValue(fromDate));
  const previousFrom = previousCommitteeEventDate(events, fromDate, dayValue, fromEvent?.meetingCategory || null);
  if (!previousFrom) {
    return [{fromDate, toDate}];
  } else {
    return [
      {fromDate: previousFrom, toDate: fromDate},
      {fromDate, toDate}
    ];
  }
}
