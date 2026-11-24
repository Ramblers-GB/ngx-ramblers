import { DateTime } from "luxon";
import { SITE_TIME_ZONE } from "../models/locale.model";
import { CommitteeFile, CommitteeFileMeetingRole, CommitteeFileType, isMeetingFileType } from "../models/committee.model";
import { CommitteeStatisticsEvent } from "../models/agm-stats.model";
import { committeeMeetingHeading } from "./committee-meeting-agenda";
import { suggestedVideoMeetingTitle } from "./video-meeting-join";

export function committeeStatisticsEvents(
  files: CommitteeFile[],
  fileTypes: CommitteeFileType[],
  dateLabel: (value: number) => string
): CommitteeStatisticsEvent[] {
  const meetingFiles = (files || [])
    .filter(file => Number.isFinite(file.eventDate) && file.eventDate > 0)
    .filter(file => isMeetingFileType(file.fileType, fileTypes))
    .filter(file => !!fileTypes.find(candidate => candidate.description === file.fileType)?.meetingCategory?.trim());
  const grouped = meetingFiles.reduce<Map<string, CommitteeFile[]>>((groups, file) => {
    const category = fileTypes.find(candidate => candidate.description === file.fileType)?.meetingCategory?.trim() || "";
    const date = DateTime.fromMillis(file.eventDate, {zone: SITE_TIME_ZONE});
    const key = `${category.toLowerCase()}:${isAgmCategory(category) ? date.year : date.startOf("day").toMillis()}`;
    groups.set(key, [...(groups.get(key) || []), file]);
    return groups;
  }, new Map<string, CommitteeFile[]>());
  return [...grouped.values()].map(group => {
    const agendas = group.filter(file => fileTypes.find(candidate => candidate.description === file.fileType)?.meetingRole === CommitteeFileMeetingRole.AGENDA);
    const candidates = agendas.length ? agendas : group;
    const dates = [...new Set(candidates.map(file => DateTime.fromMillis(file.eventDate, {zone: SITE_TIME_ZONE}).startOf("day").toMillis()))];
    const file = [...candidates].sort((left, right) => right.eventDate - left.eventDate)[0];
    const category = fileTypes.find(candidate => candidate.description === file.fileType)?.meetingCategory?.trim() || "";
    const heading = committeeMeetingHeading(
      file.meeting?.title || file.document?.title || file.fileNameData?.title || file.fileType || "",
      category
    );
    return {
      date: file.eventDate,
      label: suggestedVideoMeetingTitle(heading, dateLabel(file.eventDate)),
      meetingCategory: category,
      sourceDates: [...new Set(group.map(source => source.eventDate))],
      ambiguous: isAgmCategory(category) && dates.length > 1
    };
  }).sort((left, right) => right.date - left.date);
}

export function previousCommitteeEventDate(
  events: CommitteeStatisticsEvent[],
  selectedDate: number,
  dayValue: (value: number) => number = value => value,
  meetingCategory: string | null = null
): number | null {
  const selectedDay = dayValue(selectedDate);
  const wanted = (meetingCategory || "").trim().toLowerCase();
  const previous = [...(events || [])].sort((left, right) => right.date - left.date).find(event =>
    dayValue(event.date) < selectedDay
    && (!wanted || (event.meetingCategory || "").trim().toLowerCase() === wanted)
    && (!isAgmCategory(wanted) || DateTime.fromMillis(event.date, {zone: SITE_TIME_ZONE}).year < DateTime.fromMillis(selectedDate, {zone: SITE_TIME_ZONE}).year)
  );
  return previous?.date || null;
}

export function latestAgmReportingRange(events: CommitteeStatisticsEvent[]): {fromDate: number; toDate: number} | null {
  const agms = (events || []).filter(event => isAgmCategory(event.meetingCategory)).sort((left, right) => right.date - left.date);
  const previous = agms.length ? previousCommitteeEventDate(agms, agms[0].date, value => value, agms[0].meetingCategory) : null;
  if (previous) {
    return {fromDate: previous, toDate: agms[0].date};
  } else {
    return null;
  }
}

export function committeeEventComparisonPeriods(
  fromDate: number,
  toDate: number,
  events: CommitteeStatisticsEvent[],
  dayValue: (value: number) => number = value => value,
  requireEndEvent = true
): {fromDate: number; toDate: number}[] {
  const fromEvent = committeeStatisticsEventMatching(events, fromDate, dayValue);
  const toEvent = requireEndEvent ? committeeStatisticsEventMatching(events, toDate, dayValue) : null;
  if (!fromEvent) {
    throw new Error("The starting committee event could not be found. Select a meeting again.");
  } else if (requireEndEvent && !toEvent) {
    throw new Error("The ending committee event could not be found. Select a meeting again.");
  } else if (toEvent && fromEvent.meetingCategory.trim().toLowerCase() !== toEvent.meetingCategory.trim().toLowerCase()) {
    throw new Error("Choose the same meeting type for the start and end of the report.");
  } else {
    const previousFrom = previousCommitteeEventDate(events, fromEvent.date, dayValue, fromEvent.meetingCategory);
    const selectedEvents = [fromEvent, toEvent, events.find(event => event.date === previousFrom)].filter(Boolean);
    if (selectedEvents.some(event => event.ambiguous)) {
      throw new Error("More than one AGM meeting date was found for a year in this report. Check the AGM agenda dates (or minutes dates where there is no agenda) on the committee pages, then reload the report.");
    } else if (toEvent && isAgmCategory(fromEvent.meetingCategory) && DateTime.fromMillis(fromEvent.date, {zone: SITE_TIME_ZONE}).year === DateTime.fromMillis(toEvent.date, {zone: SITE_TIME_ZONE}).year) {
      throw new Error("An annual AGM comparison needs meetings from different years.");
    } else {
      const currentFrom = DateTime.fromMillis(fromEvent.date, {zone: SITE_TIME_ZONE}).startOf("day").toMillis();
      const currentTo = DateTime.fromMillis(toEvent?.date || toDate, {zone: SITE_TIME_ZONE}).endOf("day").toMillis();
      if (currentTo <= currentFrom) {
        throw new Error("Choose an ending meeting after the starting meeting.");
      } else {
        return previousFrom ? [
          {fromDate: DateTime.fromMillis(previousFrom, {zone: SITE_TIME_ZONE}).startOf("day").toMillis(), toDate: currentFrom - 1},
          {fromDate: currentFrom, toDate: currentTo}
        ] : [{fromDate: currentFrom, toDate: currentTo}];
      }
    }
  }
}

export function committeeStatisticsEventMatching(
  events: CommitteeStatisticsEvent[],
  date: number,
  dayValue: (value: number) => number = value => value
): CommitteeStatisticsEvent | null {
  return (events || []).find(event => dayValue(event.date) === dayValue(date))
    || (events || []).find(event => (event.sourceDates || []).some(source => dayValue(source) === dayValue(date)))
    || null;
}

function isAgmCategory(category: string): boolean {
  return (category || "").trim().toLowerCase() === "agm";
}
