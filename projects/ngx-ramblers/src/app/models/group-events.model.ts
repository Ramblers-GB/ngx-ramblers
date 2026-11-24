import { Media, RamblersEventType } from "./ramblers-walks-manager.model";
import { HasColumnRange } from "./content-text.model";
import { FilterCriteria, SortOrder } from "./api-request.model";
import { SavedSearchCriteria } from "./search.model";

export enum DateRangeMode {
  DATE_PICKERS = "DATE_PICKERS",
  SLIDER = "SLIDER",
}

export enum GroupEventEditTab {
  EVENT_DETAILS = "Event Details",
  ORGANISER = "Organiser",
  IMAGES = "Images",
  ATTACHMENT = "Attachment",
}

export enum GroupEventDetailsSection {
  ALL = "All",
  EVENT = "Event",
  VENUE = "Venue",
  DESCRIPTION = "Description",
}

export interface HasMedia {
  media?: Media[];
}

export interface GroupEventsPermissions {
  admin?: boolean;
  detailView?: boolean;
  summaryView?: boolean;
  delete?: boolean;
  edits?: boolean;
  copy?: boolean;
  contentEdits?: boolean;
}

export interface EventsDataAllows {
  autoTitle?: boolean;
  quickSearch?: boolean;
  pagination?: boolean;
  addNew?: boolean;
  alert?: boolean;
  advancedSearch?: boolean;
  viewSelector?: boolean;
  allowFilterChange?: boolean;
  allowSortChange?: boolean;
}

export interface EventNotice {
  eventId: string;
  title?: string;
  message?: string;
}

export const EVENT_NOTICE_DEFAULT_TITLE = "Walk details changed";

export enum EventsSelection {
  BY_DATE = "by-date",
  PICKED = "picked"
}

export enum EventsView {
  CARDS = "cards",
  ACTION_BUTTONS = "action-buttons"
}

export interface EventCardDisplayOptions {
  showImage?: boolean;
  showDate?: boolean;
  showDifficulty?: boolean;
  showDistance?: boolean;
  showAscent?: boolean;
  showLocation?: boolean;
  showGroup?: boolean;
  showContact?: boolean;
}

export interface EventsData extends HasColumnRange {
  filterCriteria: FilterCriteria;
  sortOrder: SortOrder;
  allow: EventsDataAllows;
  eventTypes: RamblersEventType[];
  selection?: EventsSelection;
  eventNotices?: EventNotice[];
  includeUpcomingCancellations?: boolean;
  view?: EventsView;
  compact?: boolean;
  cardDisplay?: EventCardDisplayOptions;
  savedCriteria?: SavedSearchCriteria;
  fromDate?: number;
  toDate?: number;
  dateRangeMode?: DateRangeMode;
  eventIds?: string[];
  tagsAny?: number[];
  tagsExclude?: number[];
}

export function eventsArePicked(eventsData: EventsData | null | undefined): boolean {
  return eventsData?.selection === EventsSelection.PICKED;
}

export function eventNoticeFor(eventsData: EventsData | null | undefined, eventIds: string[]): EventNotice | null {
  const notice = (eventsData?.eventNotices || []).find(item => eventIds.includes(item.eventId));
  return notice && (notice.title?.trim() || notice.message?.trim()) ? notice : null;
}
