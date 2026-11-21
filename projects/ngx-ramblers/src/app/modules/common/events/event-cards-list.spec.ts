import { TestBed } from "@angular/core/testing";
import { EventCardsList } from "./event-cards-list";
import { DistanceValidationService } from "../../../services/walks/distance-validation.service";
import { EventDatesAndTimesPipe } from "../../../pipes/event-times-and-dates.pipe";
import { GroupEventDisplayService } from "../../../pages/group-events/group-event-display.service";
import { WalkDisplayService } from "../../../pages/walks/walk-display.service";
import { StringUtilsService } from "../../../services/string-utils.service";
import { DateUtilsService } from "../../../services/date-utils.service";
import { ExtendedGroupEvent } from "../../../models/group-event.model";
import { EventsData, EventsView } from "../../../models/group-events.model";
import { RamblersEventType, WalkStatus } from "../../../models/ramblers-walks-manager.model";

describe("Event action buttons", () => {
  function component(): EventCardsList {
    TestBed.configureTestingModule({providers: [
      {provide: DistanceValidationService, useValue: {walkDistances: () => "5 miles"}},
      {provide: EventDatesAndTimesPipe, useValue: {transform: () => "Saturday 21 November"}},
      {provide: GroupEventDisplayService, useValue: {groupEventLink: () => "/social/hillside-supper"}},
      {provide: WalkDisplayService, useValue: {walkRouterLink: () => "/walks/hillside-park"}},
      {provide: StringUtilsService, useValue: {}},
      {provide: DateUtilsService, useValue: {}}
    ]});
    return TestBed.runInInjectionContext(() => new EventCardsList());
  }

  function event(type = RamblersEventType.GROUP_WALK): ExtendedGroupEvent {
    return {id: "event-one", groupEvent: {
      id: "walk-one", title: "Hillside Park", item_type: type,
      status: WalkStatus.CANCELLED, cancellation_reason: "Flooded paths", distance_miles: 5
    }} as ExtendedGroupEvent;
  }

  it("keeps cancellation reasons when optional detail is hidden", () => {
    const view = component();
    view.eventsData = {view: EventsView.ACTION_BUTTONS, maxColumns: 3,
      cardDisplay: {showDate: false, showDistance: false}} as EventsData;
    view.currentPageFilteredEvents = [event()];
    const column = view.actionButtonContent().rows[0].columns[0];
    expect(column.title).toBe("Hillside Park");
    expect(column.href).toBe("/walks/hillside-park");
    expect(column.contentText).toBe("Cancelled: Flooded paths");
  });

  it("uses the configured grid and only the events on the current page", () => {
    const view = component();
    view.eventsData = {minColumns: 1, maxColumns: 3} as EventsData;
    view.currentPageFilteredEvents = [event(), {...event(), id: "event-two"}, {...event(), id: "event-three"}];
    const row = view.actionButtonContent().rows[0];
    expect(row.maxColumns).toBe(3);
    expect(row.columns.length).toBe(3);
    expect(row.showSwiper).toBe(false);
  });

  it("uses social event links and retains default date and distance details", () => {
    const view = component();
    view.currentPageFilteredEvents = [event(RamblersEventType.GROUP_EVENT)];
    const column = view.actionButtonContent().rows[0].columns[0];
    expect(column.href).toBe("/social/hillside-supper");
    expect(column.contentText).toContain("Saturday 21 November");
    expect(column.contentText).toContain("5 miles");
  });
});
