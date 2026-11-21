import { Component, inject, Input, OnInit } from "@angular/core";
import { faAdd, faPencil, faSearch } from "@fortawesome/free-solid-svg-icons";
import { NgxLoggerLevel } from "ngx-logger";
import { PageContentRow } from "../../../models/content-text.model";
import { LoggerFactory } from "../../../services/logger-factory.service";
import { MemberResourcesReferenceDataService } from "../../../services/member/member-resources-reference-data.service";
import { PageContentActionsService } from "../../../services/page-content-actions.service";
import { StringUtilsService } from "../../../services/string-utils.service";
import { NumberUtilsService } from "../../../services/number-utils.service";
import { PageContentService } from "../../../services/page-content.service";
import { ContentMetadataService } from "../../../services/content-metadata.service";
import { UrlService } from "../../../services/url.service";
import { enumValues, KeyValue, TypedKeyValue } from "../../../functions/enums";
import { FormsModule } from "@angular/forms";
import { EventsRow } from "../events/events-row";
import { DatePicker } from "../../../date-and-time/date-picker";
import { DateUtilsService } from "../../../services/date-utils.service";
import { RamblersEventType } from "../../../models/ramblers-walks-manager.model";
import { NgSelectComponent } from "@ng-select/ng-select";
import { DynamicContentMaxColumnsEditorComponent } from "./dynamic-content-max-columns-editor";
import { BroadcastService } from "../../../services/broadcast-service";
import { NamedEvent, NamedEventType } from "../../../models/broadcast.model";
import { DateRangeMode, EventCardDisplayOptions, EventsData, EventsDataAllows, EventsView } from "../../../models/group-events.model";
import { DYNAMIC_CONTENT_FILTER_OPTIONS, FilterCriteria, SortOrder } from "../../../models/api-request.model";
import { GroupEventDisplayService } from "../../../pages/group-events/group-event-display.service";
import { HasStartAndEndTime } from "../../../models/group-event.model";
import { GroupEventSummary, GroupEventTypes } from "../../../models/committee.model";
import { GroupEventSelectorComponent } from "../../../group-events-selector/group-event-selector";
import { DateRange, DateRangeSlider } from "../../../components/date-range-slider/date-range-slider";
import { DateTime } from "luxon";
import { SystemConfigService } from "../../../services/system/system-config.service";
import { SystemConfig } from "../../../models/system.model";
import { Subscription } from "rxjs";
import { Tag } from "../../../models/tag.model";
import { TagEditorComponent } from "../../../pages/tag/tag-editor.component";

@Component({
  selector: "app-dynamic-content-site-edit-events",
  styleUrls: ["./dynamic-content.sass"],
  template: `
    @if (row?.events?.eventTypes) {

      <div class="row align-items-end mb-3 d-flex">
        <div class="col-md-12">
          <div class="form-group">
            <label
              for="event-type-multi-select-{{id}}">Ramblers {{ stringUtils.pluralise(row.events.eventTypes.length, 'Event Type') }}
              ({{ row.events.eventTypes.length }}
              of {{ eventTypes.length }} selected)</label>
            <ng-select id="event-type-multi-select-{{id}}"
                       [items]="eventTypes"
                       bindLabel="value"
                       bindValue="key"
                       [multiple]="true"
                       [searchable]="true"
                       [clearable]="true"
                       placeholder="Select one or more event types..."
                       (ngModelChange)="modelChange($event)"
                       [ngModel]="row.events.eventTypes">
            </ng-select>
          </div>
        </div>
      </div>

      <div class="row d-flex mb-3">
        <div class="col-md-12 d-inline-flex align-items-center flex-wrap gap-3 px-0 pb-2 ms-3">
          <div class="col-auto">
            <div class="form-check form-check-inline mb-0">
              <input [(ngModel)]="row.events.allow.viewSelector"
                     (ngModelChange)="broadcastChange()"
                     type="checkbox" class="form-check-input"
                     [id]="id +'-view-selector'">
              <label class="form-check-label"
                     [for]="id +'-view-selector'">Full mode
              </label>
            </div>
          </div>
          <div class="col-auto">
            <div class="form-check form-check-inline mb-0">
              <input [(ngModel)]="row.events.allow.autoTitle"
                     (ngModelChange)="broadcastChange()"
                     type="checkbox" class="form-check-input"
                     [id]="id +'-auto-title'">
              <label class="form-check-label"
                     [for]="id +'-auto-title'">Auto Title
              </label>
            </div>
          </div>
          <div class="col-auto">
            <div class="form-check form-check-inline mb-0">
              <input [(ngModel)]="row.events.allow.alert"
                     (ngModelChange)="broadcastChange()"
                     type="checkbox" class="form-check-input"
                     [id]="id +'-alert-indicator'">
              <label class="form-check-label"
                     [for]="id +'-alert-indicator'">Alert Indicator
              </label>
            </div>
          </div>
          <div class="col-auto">
            <div class="form-check form-check-inline mb-0">
              <input [(ngModel)]="row.events.allow.addNew"
                     (ngModelChange)="broadcastChange()"
                     type="checkbox" class="form-check-input"
                     [id]="id +'-add-new-event'">
              <label class="form-check-label"
                     [for]="id +'-add-new-event'">Add New Event
              </label>
            </div>
          </div>
          <div class="col-auto">
            <div class="form-check form-check-inline mb-0">
              <input [(ngModel)]="row.events.allow.advancedSearch"
                     (ngModelChange)="broadcastChange()"
                     type="checkbox" class="form-check-input"
                     [id]="id +'-advanced-search-common'">
              <label class="form-check-label"
                     [for]="id +'-advanced-search-common'">Advanced Search
              </label>
            </div>
          </div>
        </div>
      </div>

      @if (!row.events.allow.viewSelector) {
        <div class="thumbnail-heading-frame mb-3">
          <div class="thumbnail-heading">Event presentation</div>
          <div class="form-group mb-3">
            <label [for]="id + '-events-view'">View</label>
            <select class="form-control" [id]="id + '-events-view'"
                    [ngModel]="row.events.view || EventsView.CARDS"
                    (ngModelChange)="row.events.view = $event; broadcastChange()">
              <option [ngValue]="EventsView.CARDS">Cards</option>
              <option [ngValue]="EventsView.ACTION_BUTTONS">Action buttons</option>
            </select>
          </div>
          <div class="form-check mb-3">
            <input type="checkbox" class="form-check-input" [id]="id + '-include-cancellations'"
                   [(ngModel)]="row.events.includeUpcomingCancellations" (ngModelChange)="broadcastChange()">
            <label class="form-check-label" [for]="id + '-include-cancellations'">Automatically include all upcoming cancellations</label>
            <div class="form-text">Add cancelled events from today onwards for the selected event types, even outside this block's date or tag filters. Each event appears once.</div>
          </div>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button type="button" class="btn btn-primary" (click)="applyCardDetail(false)">Full details</button>
            <button type="button" class="btn btn-primary" (click)="applyCardDetail(true)">Compact summary</button>
          </div>
          <p class="form-text">Choose which details appear on this events block. Titles and cancellation notices are always shown. Select a title to read the full event. Action buttons use the column settings below to form a grid.</p>
          <div class="d-flex flex-wrap gap-3">
            @for (option of visibleCardDetailOptions(); track option.key) {
              <div class="form-check">
                <input type="checkbox" class="form-check-input" [id]="id + '-' + option.key"
                       [ngModel]="row.events.cardDisplay?.[option.key] !== false"
                       (ngModelChange)="changeCardDetail(option.key, $event)">
                <label class="form-check-label" [for]="id + '-' + option.key">{{ option.value }}</label>
              </div>
            }
          </div>
        </div>
        <div class="row align-items-end mb-3 d-flex">
          <div class="col-md-4">
            <div class="form-group">
              <label for="filter-criteria-{{id}}">Filter Criteria</label>
              <select [(ngModel)]="row.events.filterCriteria"
                      (ngModelChange)="broadcastChange()"
                      name="selectType"
                      class="form-control rounded">
                @for (dateCriteria of display.filterCriteriaOptionsFor(DYNAMIC_CONTENT_FILTER_OPTIONS); track dateCriteria.value) {
                  <option [ngValue]="dateCriteria.key">{{ dateCriteria.value }}</option>
                }
              </select>
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group">
              <label for="sort-order-{{id}}">Sort Order</label>
              <select [(ngModel)]="row.events.sortOrder"
                      (ngModelChange)="broadcastChange()" name="sortOrder" id="sort-order-{{id}}"
                      class="form-control rounded">
                @for (sortOrder of display.sortOrderOptions(row.events.sortOrder); track sortOrder.value) {
                  <option [ngValue]="sortOrder.key">{{ sortOrder.value }}</option>
                }
              </select>
            </div>
          </div>
          <div class="col-md-4">
            <div class="form-group" app-dynamic-content-max-columns-editor [hasColumnRange]="row.events"
                 (columnsChange)="broadcastChange()"></div>
          </div>
        </div>
        <div class="row align-items-end mb-3 d-flex">
          <div class="col-md-4">
            <div class="form-group">
              <label for="date-range-mode-{{id}}">Date Selection</label>
              <select [(ngModel)]="row.events.dateRangeMode"
                      (ngModelChange)="broadcastChange()"
                      [disabled]="row.events.filterCriteria !== FilterCriteria.DATE_RANGE"
                      id="date-range-mode-{{id}}"
                      class="form-control rounded">
                @for (mode of dateRangeModes; track mode.key) {
                  <option [ngValue]="mode.key">{{ mode.value }}</option>
                }
              </select>
            </div>
          </div>
          @if (row.events.dateRangeMode === DateRangeMode.SLIDER) {
            <div class="col-md-8">
              <app-date-range-slider
                [minDate]="sliderMinDate"
                [maxDate]="sliderMaxDate"
                [range]="currentDateRange()"
                (rangeChange)="onSliderRangeChange($event)"/>
            </div>
          } @else {
            <div class="col-md-4">
              <div class="form-group">
                <label for="from-date-{{id}}">Select Events From</label>
                <app-date-picker    startOfDay
                                 [disabled]="row.events.filterCriteria !== FilterCriteria.DATE_RANGE"
                                 id="from-date-{{id}}"
                                 [size]="'md round'"
                                 (change)="row.events.fromDate=$event.value;broadcastChange()"
                                 [value]="row.events.fromDate">
                </app-date-picker>
              </div>
            </div>
            <div class="col-md-4">
              <div class="form-group">
                <label for="to-date-{{id}}">Select Events To</label>
                <app-date-picker startOfDay
                                 [disabled]="row.events.filterCriteria !== FilterCriteria.DATE_RANGE"
                                 id="to-date-{{id}}"
                                 [size]="'md round'"
                                 (change)="row.events.toDate=$event.value;broadcastChange()"
                                 [value]="row.events.toDate">
                </app-date-picker>
              </div>
            </div>
          }
        </div>
        <div class="row mb-3">
          <div class="col-md-12">
            <app-group-event-selector
              [multiple]="true"
              [hideDatePickers]="true"
              [fromDate]="row.events.fromDate"
              [toDate]="row.events.toDate"
              [label]="'Specific Events (leave empty to show all events within date range)'"
              [dataSource]="eventTypeDataSource()"
              [eventIds]="row.events.eventIds"
              (eventsChange)="onEventsChange($event)"/>
          </div>
        </div>
        <div class="row d-flex mb-3">
          <div class="col-md-12 d-inline-flex align-items-center flex-wrap gap-3 px-0 pb-2 ms-3">
            <div class="col-auto">
              <div class="form-check form-check-inline mb-0">
                <input [(ngModel)]="row.events.allow.quickSearch"
                       (ngModelChange)="broadcastChange()"
                       type="checkbox" class="form-check-input"
                       [id]="id +'-quick-search'">
                <label class="form-check-label"
                       [for]="id +'-quick-search'">Quick Search
                </label>
              </div>
            </div>
            <div class="col-auto">
              <div class="form-check form-check-inline mb-0">
                <input [(ngModel)]="row.events.allow.pagination"
                       (ngModelChange)="broadcastChange()"
                       type="checkbox" class="form-check-input"
                       [id]="id +'-pagination'">
                <label class="form-check-label"
                       [for]="id +'-pagination'">Pagination
                </label>
              </div>
            </div>
            <div class="col-auto">
              <div class="form-check form-check-inline mb-0">
                <input [(ngModel)]="row.events.allow.allowFilterChange"
                       (ngModelChange)="broadcastChange()"
                       type="checkbox" class="form-check-input"
                       [id]="id +'-allow-filter-change'">
                <label class="form-check-label"
                       [for]="id +'-allow-filter-change'">Allow User to Change Filter
                </label>
              </div>
            </div>
            <div class="col-auto">
              <div class="form-check form-check-inline mb-0">
                <input [(ngModel)]="row.events.allow.allowSortChange"
                       (ngModelChange)="broadcastChange()"
                       type="checkbox" class="form-check-input"
                       [id]="id +'-allow-sort-change'">
                <label class="form-check-label"
                       [for]="id +'-allow-sort-change'">Allow User to Change Sort
                </label>
              </div>
            </div>
          </div>
        </div>
        @if (eventTagsAvailable()) {
          <div class="row align-items-end mb-3 d-flex">
            <div class="col-md-6">
              <div class="form-group">
                <app-tag-editor [tagsForItem]="row.events.tagsAny || []"
                                [availableTags]="config.group.eventTags"
                                [text]="'tags-any-' + id"
                                label="Include events with any of these tags"
                                (tagsChange)="onTagsAnyChange($event)"/>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <app-tag-editor [tagsForItem]="row.events.tagsExclude || []"
                                [availableTags]="config.group.eventTags"
                                [text]="'tags-exclude-' + id"
                                label="Exclude events with any of these tags"
                                (tagsChange)="onTagsExcludeChange($event)"/>
              </div>
            </div>
          </div>
        }
      }
    }
    <app-events-row [row]="row" [rowIndex]="rowIndex" [queryIndex]="queryIndex"/>`,
  imports: [FormsModule, EventsRow, DatePicker, NgSelectComponent, DynamicContentMaxColumnsEditorComponent, GroupEventSelectorComponent, DateRangeSlider, TagEditorComponent]
})
export class DynamicContentSiteEditEvents implements OnInit {
  public display: GroupEventDisplayService = inject(GroupEventDisplayService);
  public pageContentService: PageContentService = inject(PageContentService);
  public memberResourcesReferenceData: MemberResourcesReferenceDataService = inject(MemberResourcesReferenceDataService);
  public contentMetadataService: ContentMetadataService = inject(ContentMetadataService);
  public stringUtils: StringUtilsService = inject(StringUtilsService);
  public urlService: UrlService = inject(UrlService);
  private numberUtils: NumberUtilsService = inject(NumberUtilsService);
  private broadcastService = inject<BroadcastService<any>>(BroadcastService);
  public actions: PageContentActionsService = inject(PageContentActionsService);
  protected dateUtils = inject(DateUtilsService);
  private systemConfigService = inject(SystemConfigService);
  protected logger = inject(LoggerFactory).createLogger("DynamicContentSiteEditEvents", NgxLoggerLevel.ERROR);
  public instance = this;
  protected config?: SystemConfig;
  private subscriptions: Subscription[] = [];
  @Input()
  public row: PageContentRow;
  @Input() rowIndex: number;
  @Input() queryIndex = 0;
  faPencil = faPencil;
  faAdd = faAdd;
  id: string;
  protected readonly faSearch = faSearch;
  public eventTypes: KeyValue<string>[] = enumValues(RamblersEventType).map(item => ({
    key: item,
    value: this.stringUtils.asTitle(item)
  }));

  protected readonly DYNAMIC_CONTENT_FILTER_OPTIONS = DYNAMIC_CONTENT_FILTER_OPTIONS;
  protected readonly FilterCriteria = FilterCriteria;
  protected readonly DateRangeMode = DateRangeMode;
  protected fromAndTo: HasStartAndEndTime;
  public dateRangeModes: KeyValue<string>[] = enumValues(DateRangeMode).map(item => ({
    key: item,
    value: this.stringUtils.asTitle(item)
  }));

  protected readonly EventsView = EventsView;

  visibleCardDetailOptions(): TypedKeyValue<keyof EventCardDisplayOptions, string>[] {
    return this.row.events.view === EventsView.ACTION_BUTTONS
      ? this.cardDetailOptions.filter(option => option.key === "showDate" || option.key === "showDistance")
      : this.cardDetailOptions;
  }

  readonly cardDetailOptions: TypedKeyValue<keyof EventCardDisplayOptions, string>[] = [
    {key: "showImage", value: "Images and maps"},
    {key: "showDate", value: "Date and time"},
    {key: "showDifficulty", value: "Difficulty"},
    {key: "showDistance", value: "Distance"},
    {key: "showAscent", value: "Ascent"},
    {key: "showLocation", value: "Start postcode"},
    {key: "showGroup", value: "Group"},
    {key: "showContact", value: "Leader or coordinator"}
  ];

  applyCardDetail(compact: boolean): void {
    this.row.events.compact = compact;
    this.row.events.cardDisplay = {
      showImage: !compact,
      showDate: true,
      showDifficulty: !compact,
      showDistance: true,
      showAscent: !compact,
      showLocation: !compact,
      showGroup: !compact,
      showContact: !compact
    };
    this.broadcastChange();
  }

  changeCardDetail(key: keyof EventCardDisplayOptions, visible: boolean): void {
    this.row.events.cardDisplay = {...this.row.events.cardDisplay, [key]: visible};
    this.broadcastChange();
  }

  async ngOnInit() {
    this.initialiseRowForEvents(this.row);
    this.subscriptions.push(this.systemConfigService.events().subscribe(config => this.config = config));
    this.logger.info("ngOnInit:row:", this.row, "eventTypes:", this.eventTypes);
    this.id = this.numberUtils.generateUid();
  }

  eventTagsAvailable(): boolean {
    return (this.config?.group?.eventTags?.length ?? 0) > 0;
  }

  async broadcastChange(): Promise<void> {
    this.broadcastService.broadcast(NamedEvent.named(NamedEventType.REFRESH));
  }

  onTagsAnyChange(tags: Tag[]) {
    this.row.events.tagsAny = tags.map(tag => tag.key);
    this.broadcastChange();
  }

  onTagsExcludeChange(tags: Tag[]) {
    this.row.events.tagsExclude = tags.map(tag => tag.key);
    this.broadcastChange();
  }

  onChange($event: any) {
    this.logger.info("onChange:", $event);
  }

  private initialiseRowForEvents(row: PageContentRow) {
    if (!row?.events) {
      const allow: EventsDataAllows = {
        addNew: true,
        advancedSearch: true,
        alert: true,
        allowFilterChange: true,
        allowSortChange: true,
        autoTitle: true,
        pagination: true,
        quickSearch: true,
        viewSelector: false
      };
      const events: EventsData = {
        minColumns: 2,
        maxColumns: 2,
        allow,
        eventTypes: [RamblersEventType.GROUP_EVENT],
        fromDate: this.dateUtils.dateTimeNow().toMillis(),
        toDate: this.dateUtils.dateTimeNow().plus({years: 1}).toMillis(),
        filterCriteria: FilterCriteria.FUTURE_EVENTS,
        sortOrder: SortOrder.DATE_ASCENDING,
        dateRangeMode: DateRangeMode.DATE_PICKERS
      };
      this.logger.info("initialiseRowForEvents:row:", this.row, "events:", events);
      row.events = events;
      this.fromAndTo = this.display.fromAndToFrom(row.events);
    } else {
      if (!row.events.eventTypes) {
        const legacyEventType = (row.events as any)?.eventType;
        row.events.eventTypes = legacyEventType ? [legacyEventType] : [RamblersEventType.GROUP_EVENT];
      }
      if (!row.events.allow) {
        row.events.allow = {addNew: false, pagination: false, quickSearch: false};
      }
      if (!row.events.filterCriteria) {
        row.events.filterCriteria = FilterCriteria.FUTURE_EVENTS;
      }
      if (!row.events.sortOrder) {
        row.events.sortOrder = SortOrder.DATE_ASCENDING;
      }
      if (!row.events.dateRangeMode) {
        row.events.dateRangeMode = DateRangeMode.DATE_PICKERS;
      }
      this.logger.info("initialiseRowForEvents:row already has events:", this.row.events);
    }
    this.applyGroupEventsViewSelector();
  }

  groupEventsMode(): boolean {
    const types = this.row?.events?.eventTypes || [];
    return types.length > 0 && types.every(type => type === RamblersEventType.GROUP_EVENT);
  }

  applyGroupEventsViewSelector(): void {
    if (this.groupEventsMode() && this.row?.events?.allow) {
      this.row.events.allow.viewSelector = false;
    }
  }

  modelChange(eventTypes: RamblersEventType[]) {
    this.row.events.eventTypes = eventTypes;
    this.applyGroupEventsViewSelector();
    this.logger.info("modelChange:eventTypes:", eventTypes, "row.events:", this.row.events);
    this.broadcastChange();
  }

  eventTypeDataSource(): string {
    return GroupEventTypes.WALK.area;
  }

  onEventsChange(events: GroupEventSummary[]) {
    this.row.events.eventIds = events.map(event => event.id);
    this.logger.info("onEventsChange:", events.length, "events selected, eventIds:", this.row.events.eventIds);
    this.broadcastChange();
  }

  readonly sliderMinDate: DateTime = DateTime.now().minus({months: 6}).startOf("day");
  readonly sliderMaxDate: DateTime = DateTime.now().plus({years: 1}).startOf("day");

  currentDateRange(): DateRange {
    return {
      from: this.row.events.fromDate,
      to: this.row.events.toDate
    };
  }

  onSliderRangeChange(range: DateRange) {
    this.row.events.fromDate = range.from;
    this.row.events.toDate = range.to;
    this.broadcastChange();
  }
}
