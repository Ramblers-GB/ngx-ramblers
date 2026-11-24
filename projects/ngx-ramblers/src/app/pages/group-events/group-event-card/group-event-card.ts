import { EVENT_NOTICE_DEFAULT_TITLE, EventCardDisplayOptions, EventNotice } from "../../../models/group-events.model";
import { EventNoticeAlert } from "../../../modules/common/event-notice-alert/event-notice-alert";
import { Component, inject, Input, OnInit } from "@angular/core";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { NgxLoggerLevel } from "ngx-logger";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { AlertInstance } from "../../../services/notifier.service";
import { GroupEventDisplayService } from "../group-event-display.service";
import { EventDatesAndTimesPipe } from "../../../pipes/event-times-and-dates.pipe";
import { ExtendedGroupEvent } from "../../../models/group-event.model";
import { BasicMedia } from "../../../models/ramblers-walks-manager.model";
import { MediaQueryService } from "../../../services/committee/media-query.service";
import { DateUtilsService } from "../../../services/date-utils.service";
import { CardImageOrMap } from "../../../modules/common/card/image/card-image-or-map";
import { WalkDisplayService } from "../../walks/walk-display.service";
import { DisplayedWalk } from "../../../models/walk.model";
import { EventGroupComponent } from "../../walks/walk-view/event-group";
import { EventLeaderContactLinkComponent } from "../../walks/walk-view/event-leader-contact-link";

@Component({
    selector: "app-group-event-card",
    template: `
      <div class="card shadow clickable h-100 overflow-hidden">
        @if (cardDisplay?.showImage !== false) {
          <app-card-image-or-map imageNavigationEnabled [displayedWalk]="displayedWalk" [notify]="notify" [maxColumns]="maxColumns"
                               [navigationHref]="display.groupEventLink(groupEvent, true)"/>
        }
        <div class="card-body">
          <h4 class="card-title">
            <a class="rams-text-decoration-pink"
               [href]="display.groupEventLink(groupEvent, true)"
               target="_self">{{ groupEvent?.groupEvent?.title }}</a>
          </h4>
          @if (notice) {
            <app-event-notice-alert [title]="notice.title?.trim() || EVENT_NOTICE_DEFAULT_TITLE" [message]="notice.message"/>
          }
          @if (cardDisplay?.showDate !== false) {
            <div>{{ groupEvent?.groupEvent | eventDatesAndTimes }}</div>
          }
          @if (cardDisplay?.showGroup !== false) {
            <app-event-group [displayedWalk]="displayedWalk" [groupEvent]="groupEvent" compact="true"/>
          }
          @if (cardDisplay?.showContact !== false && ((walksDisplay.contactNameVisible(groupEvent) && displayedWalk?.walk?.fields?.contactDetails?.displayName)
            || walksDisplay.hasContactLink(groupEvent))) {
            <div class="mt-1">
              <span class="font-weight-bold me-1">Coordinator:</span>
              <app-event-leader-contact-link [walk]="displayedWalk.walk"
                                             [fallbackLabel]="walksDisplay.contactLinkFallbackLabel(groupEvent)"/>
            </div>
          }
        </div>
      </div>`,
  styles: [`
    :host
      display: block
      width: 100%
      min-width: 0
  `],
  providers: [DateUtilsService],
  imports: [EventNoticeAlert, EventDatesAndTimesPipe, CardImageOrMap, EventGroupComponent, EventLeaderContactLinkComponent]
})
export class GroupEventCard implements OnInit {

  private logger: Logger = inject(LoggerFactory).createLogger("GroupEventCard", NgxLoggerLevel.ERROR);
  display = inject(GroupEventDisplayService);
  mediaQueryService = inject(MediaQueryService);
  public walksDisplay = inject(WalkDisplayService);
  public notify: AlertInstance;

  @Input()
  public groupEvent: ExtendedGroupEvent;
  @Input()
  public imagePreview: string;

  faSearch = faSearch;
  protected displayedWalk: DisplayedWalk;
  @Input() maxColumns!: number;
  @Input() cardDisplay: EventCardDisplayOptions;
  @Input() notice: EventNotice | null = null;
  protected readonly EVENT_NOTICE_DEFAULT_TITLE = EVENT_NOTICE_DEFAULT_TITLE;

  ngOnInit() {
    this.logger.info("groupEvent:", this.groupEvent);
    this.displayedWalk = this.walksDisplay.toDisplayedWalk(this.groupEvent);
  }

  currentBasicMedia(): BasicMedia {
    return this.mediaQueryService.basicMediaFrom(this.groupEvent?.groupEvent)?.[0];
  }


  imageSourceOrPreview(): string {
    return this.imagePreview || this.currentBasicMedia()?.url;
  }

}
