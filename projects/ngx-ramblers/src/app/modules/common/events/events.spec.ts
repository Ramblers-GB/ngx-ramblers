import { vi } from "vitest";
import { Events } from "./events";
import { DataQueryOptions, SortOrder } from "../../../models/api-request.model";
import { ExtendedGroupEvent } from "../../../models/group-event.model";
import { EventsData, EventsSelection } from "../../../models/group-events.model";
import { groupEventIdsCriteria } from "../../../functions/group-event-id-criteria";
import { enumValues } from "../../../functions/enums";
import { RamblersEventType, WalkStatus } from "../../../models/ramblers-walks-manager.model";
import { GroupEventField } from "../../../models/walk.model";

const selectedQuery: DataQueryOptions = {criteria: {[GroupEventField.START_DATE]: {$lt: "2026-01-01"}}};

function event(id: string, start: string, cancelled = false): ExtendedGroupEvent {
  return {id, groupEvent: {id, title: "Hillside Park", start_date_time: start,
    status: cancelled ? WalkStatus.CANCELLED : WalkStatus.CONFIRMED}} as ExtendedGroupEvent;
}

function context(selected: ExtendedGroupEvent[], cancellations: ExtendedGroupEvent[], includeUpcomingCancellations = true,
                 sortOrder = SortOrder.DATE_ASCENDING) {
  const queryAndReturnEvents = vi.fn((query: DataQueryOptions) => Promise.resolve(query === selectedQuery ? selected : cancellations));
  const view = {
    eventsData: {eventIds: ["selected"], eventTypes: [RamblersEventType.GROUP_WALK], includeUpcomingCancellations} as EventsData,
    dateUtils: {isoDateTimeStartOfDay: () => "2026-11-21T00:00:00.000Z"},
    resolvedSortOrder: () => sortOrder,
    sort: () => ({[GroupEventField.START_DATE]: sortOrder === SortOrder.DATE_ASCENDING ? 1 : -1}),
    queryAndReturnEvents,
    eventsForDisplay: Events.prototype.eventsForDisplay,
    picked: Events.prototype.picked,
    eventIdsCriteria: Events.prototype["eventIdsCriteria"],
    filterByEventIds: (events: ExtendedGroupEvent[]) => Events.prototype["filterByEventIds"].call(view as unknown as Events, events)
  };
  return {view: view as unknown as Events, queryAndReturnEvents};
}

describe("Automatically included cancellations", () => {
  it("adds upcoming cancellations outside the manual date selection without duplicates", async () => {
    const selected = event("selected", "2026-11-22T10:00:00Z", true);
    const upcoming = event("upcoming", "2026-11-23T10:00:00Z", true);
    const {view, queryAndReturnEvents} = context([selected], [selected, upcoming]);
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([selected, upcoming]);
    expect(queryAndReturnEvents).toHaveBeenCalledWith({
      criteria: {
        [GroupEventField.STATUS]: WalkStatus.CANCELLED,
        [GroupEventField.START_DATE]: {$gte: "2026-11-21T00:00:00.000Z"}
      },
      sort: {[GroupEventField.START_DATE]: 1}
    }, []);
    expect(view.eventsData.eventIds).toEqual(["selected"]);
  });

  it("sorts automatic cancellations together with selected events", async () => {
    const selected = event("selected", "2026-11-22T10:00:00Z");
    const upcoming = event("upcoming", "2026-11-23T10:00:00Z", true);
    const {view} = context([selected], [upcoming], true, SortOrder.DATE_DESCENDING);
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([upcoming, selected]);
  });

  it("preserves manual selection and makes no cancellation query when disabled", async () => {
    const selected = event("selected", "2026-11-22T10:00:00Z");
    const {view, queryAndReturnEvents} = context([selected, event("other", "2026-11-23T10:00:00Z")], [], false);
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([selected]);
    expect(queryAndReturnEvents).toHaveBeenCalledTimes(1);
  });

  it("removes automatically included events when the next query no longer reports them cancelled", async () => {
    const selected = event("selected", "2026-11-22T10:00:00Z");
    const {view, queryAndReturnEvents} = context([selected], [event("upcoming", "2026-11-23T10:00:00Z", true)]);
    expect((await view.eventsForDisplay(selectedQuery)).length).toBe(2);
    queryAndReturnEvents.mockImplementation(query => Promise.resolve(query === selectedQuery ? [selected] : []));
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([selected]);
  });
});

describe("Picked walks and events", () => {
  it("shows only the picked walks and events, of any type and date, without adding cancellations", async () => {
    const richmond = event("richmond", "2026-11-15T10:00:00Z", true);
    const ightham = event("ightham", "2026-11-11T10:20:00Z");
    const {view, queryAndReturnEvents} = context([], []);
    view.eventsData = {...view.eventsData, selection: EventsSelection.PICKED, eventIds: ["richmond", "ightham"], eventTypes: [RamblersEventType.GROUP_EVENT]};
    queryAndReturnEvents.mockResolvedValueOnce([ightham, richmond]);
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([ightham, richmond]);
    expect(queryAndReturnEvents).toHaveBeenCalledTimes(1);
    expect(queryAndReturnEvents).toHaveBeenCalledWith({criteria: groupEventIdsCriteria(["richmond", "ightham"]), sort: {[GroupEventField.START_DATE]: 1}},
      ["richmond", "ightham"], enumValues(RamblersEventType));
  });

  it("shows nothing until a walk is picked", async () => {
    const {view, queryAndReturnEvents} = context([], []);
    view.eventsData = {...view.eventsData, selection: EventsSelection.PICKED, eventIds: []};
    expect(await view.eventsForDisplay(selectedQuery)).toEqual([]);
    expect(queryAndReturnEvents).not.toHaveBeenCalled();
  });
});
