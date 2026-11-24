import { DistanceValidationService } from "../../../services/walks/distance-validation.service";
import { isEqual } from "es-toolkit/compat";
import { PageContent, PageContentType } from "../../../models/content-text.model";
import { ActionButtons } from "../action-buttons/action-buttons";
import { DisplayTimePipe } from "../../../pipes/display-time.pipe";
import { EventDatesAndTimesPipe } from "../../../pipes/event-times-and-dates.pipe";
import { GroupEventDisplayService } from "../../../pages/group-events/group-event-display.service";
import { WalkStatus } from "../../../models/ramblers-walks-manager.model";
import { Component, inject, Input } from "@angular/core";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { AlertTarget } from "../../../models/alert-target.model";
import { EventNotice, eventNoticeFor, EventsData, EventsView } from "../../../models/group-events.model";
import { DateUtilsService } from "../../../services/date-utils.service";
import { AlertInstance } from "../../../services/notifier.service";
import { GroupEventCard } from "../../../pages/group-events/group-event-card/group-event-card";
import { ExtendedGroupEvent } from "../../../models/group-event.model";
import { RamblersEventType } from "../../../models/ramblers-walks-manager.model";
import { WalkCardViewComponent } from "../../../pages/walks/walk-view/walk-card-view";
import { WalkDisplayService } from "../../../pages/walks/walk-display.service";
import { StringUtilsService } from "../../../services/string-utils.service";

@Component({
  selector: "app-event-cards-list",
  template: `
    @if (eventsData?.view === EventsView.ACTION_BUTTONS) {
      <div [class.opacity-50]="notifyTarget?.busy" [class.pe-none]="notifyTarget?.busy">
        <app-action-buttons [pageContent]="actionButtonContent()" [rowIndex]="0" presentationMode/>
      </div>
    } @else {
    <div class="event-cards" [style.--event-cols]="columnCount()" [class.opacity-50]="notifyTarget?.busy"
         [class.pe-none]="notifyTarget?.busy">
      @for (extendedGroupEvent of currentPageFilteredEvents; track eventKey(extendedGroupEvent); let index = $index) {
        <div class="event-card-slot">
          @if (extendedGroupEvent.groupEvent.item_type === RamblersEventType.GROUP_EVENT) {
            <app-group-event-card [groupEvent]="extendedGroupEvent" [maxColumns]="eventsData?.maxColumns" [cardDisplay]="eventsData?.cardDisplay" [notice]="noticeFor(extendedGroupEvent)"/>
          } @else {
            <app-walk-card-view mapClass="map-card-image-events" cardImageClass="card-img-fixed-height" [index]="index"
                                class="card shadow clickable h-100" [maxColumns]="eventsData?.maxColumns"
                                [compact]="eventsData?.compact" [cardDisplay]="eventsData?.cardDisplay" [notice]="noticeFor(extendedGroupEvent)"
                                navigateOnCardClick
                                [displayedWalk]="walkDisplayService.toDisplayedWalk(extendedGroupEvent)"/>
          }
        </div>
      }
    </div>
    }`,
  styles: [`
    :host
      display: block
      width: 100%
      min-width: 0
    .event-cards
      display: grid
      grid-template-columns: minmax(0, 1fr)
      column-gap: var(--bs-gutter-x, 1.5rem)
    .event-card-slot
      min-width: 0
      margin-bottom: 1.5rem
    @media (min-width: 768px)
      .event-cards
        grid-template-columns: repeat(var(--event-cols, 1), minmax(0, 1fr))
  `],
  providers: [EventDatesAndTimesPipe, DisplayTimePipe],
  imports: [GroupEventCard, WalkCardViewComponent, ActionButtons]
})
export class EventCardsList {

  protected readonly EventsView = EventsView;
  private distanceValidation = inject(DistanceValidationService);
  private eventDates = inject(EventDatesAndTimesPipe);
  private groupDisplay = inject(GroupEventDisplayService);
  private actionContent: PageContent = null;

  actionButtonContent(): PageContent {
    const columns = (this.currentPageFilteredEvents || []).map(event => {
      const details = event.groupEvent;
      const options = this.eventsData?.cardDisplay;
      const cancelled = details.status === WalkStatus.CANCELLED;
      const contentText = [
        options?.showDate !== false ? this.eventDates.transform(details) : null,
        cancelled ? `Cancelled${details.cancellation_reason ? ": " + details.cancellation_reason : ""}` : null,
        options?.showDistance !== false && details.distance_miles ? this.distanceValidation.walkDistances(event) : null
      ].filter(Boolean).join("\n\n");
      return {
        title: details.title,
        href: details.item_type === RamblersEventType.GROUP_EVENT
          ? this.groupDisplay.groupEventLink(event, true) : this.walkDisplayService.walkRouterLink(event),
        contentText,
        icon: cancelled ? "faCircleExclamation" : "faCalendarDays",
        showPlaceholderImage: false
      };
    });
    const next: PageContent = {
      path: "event-actions",
      rows: [{type: PageContentType.ACTION_BUTTONS, maxColumns: this.columnCount(), showSwiper: false, columns}]
    };
    if (!isEqual(this.actionContent, next)) {
      this.actionContent = next;
    }
    return this.actionContent;
  }

  walkDisplayService = inject(WalkDisplayService);
  private stringUtils = inject(StringUtilsService);
  protected dateUtils = inject(DateUtilsService);
  public notify: AlertInstance;
  faSearch = faSearch;

  @Input() public notifyTarget: AlertTarget;
  @Input() public currentPageFilteredEvents: ExtendedGroupEvent[];
  @Input() public eventsData: EventsData;

  protected readonly RamblersEventType = RamblersEventType;

  columnCount(): number {
    const eventCount = this.currentPageFilteredEvents?.length || 1;
    const minCols = this.eventsData?.minColumns || 1;
    const maxCols = this.eventsData?.maxColumns || 2;
    return Math.max(minCols, Math.min(eventCount, maxCols));
  }

  noticeFor(extendedGroupEvent: ExtendedGroupEvent): EventNotice | null {
    return eventNoticeFor(this.eventsData, [extendedGroupEvent?.id, extendedGroupEvent?.groupEvent?.id].filter(id => !!id));
  }

  eventKey(extendedGroupEvent: ExtendedGroupEvent): string {
    const groupEvent = extendedGroupEvent?.groupEvent;
    const baseKey = groupEvent?.id || extendedGroupEvent?.id || groupEvent?.url;
    if (baseKey) {
      return baseKey;
    }
    const dateKey = groupEvent?.start_date_time || "event";
    const titleKey = groupEvent?.title || "unknown";
    const idKey = extendedGroupEvent?.id || groupEvent?.url || "id";
    return this.stringUtils.kebabCase(dateKey, titleKey, idKey);
  }
}
