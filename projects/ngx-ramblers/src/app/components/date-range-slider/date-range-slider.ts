import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from "@angular/core";
import { DOCUMENT } from "@angular/common";

import { FormsModule } from "@angular/forms";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCalendar } from "@fortawesome/free-solid-svg-icons";
import { DateUtilsService } from "../../services/date-utils.service";
import { DateTime } from "luxon";
import { Subject } from "rxjs";
import { debounceTime } from "rxjs/operators";
import { UIDateFormat } from "../../models/date-format.model";
import { coerceBooleanProperty } from "@angular/cdk/coercion";
import { PresetSelect } from "../../modules/common/preset-select/preset-select";
import { DATE_RANGE_SLIDER_PRESETS, DateRangeSliderAxisTick, DateRangeSliderPreset, DateRangeSliderUnit } from "../../models/date.model";
import { relativeDateRangeBounds } from "../../models/search.model";

export interface DateRange {
  from: number;
  to: number;
}

export function dateRangeSliderBounds(fromDate: DateTime, toDate: DateTime, paddingRatio: number = 0, minimumPaddingDays: number = 0) {
  const minimumSpanMillis = 24 * 60 * 60 * 1000;
  const spanMillis = Math.max(toDate.diff(fromDate).toMillis(), minimumSpanMillis);
  const paddingMillis = Math.max(spanMillis * paddingRatio, minimumPaddingDays * minimumSpanMillis);
  return {
    minDate: fromDate.minus({milliseconds: paddingMillis}).startOf("day"),
    maxDate: toDate.plus({milliseconds: paddingMillis}).startOf("day")
  };
}

const DATE_TICK_WIDTH_PERCENT = 16;
const HOUR_TICK_WIDTH_PERCENT = 8;
const TICK_LABEL_GAP_PX = 8;

export type TickLabelWidthPercent = (label: string) => number;

export function measuredTickLabelWidthPercent(measureLabelPx: (label: string) => number, axisWidthPx: number): TickLabelWidthPercent | null {
  if (axisWidthPx > 0) {
    return label => Math.min(100, ((measureLabelPx(label) + TICK_LABEL_GAP_PX) / axisWidthPx) * 100);
  } else {
    return null;
  }
}

function tickLabelBounds(percent: number, start: boolean, end: boolean, widthPercent: number): {left: number; right: number} {
  if (start) {
    return {left: 0, right: widthPercent};
  } else if (end) {
    return {left: 100 - widthPercent, right: 100};
  } else {
    return {left: percent - widthPercent / 2, right: percent + widthPercent / 2};
  }
}

function tickLabelsOverlap(left: DateRangeSliderAxisTick, right: DateRangeSliderAxisTick, widthPercent: TickLabelWidthPercent): boolean {
  const first = tickLabelBounds(left.percent, left.start, left.end, widthPercent(left.label));
  const second = tickLabelBounds(right.percent, right.start, right.end, widthPercent(right.label));
  return first.left < second.right && second.left < first.right;
}

export function dateRangeSliderAxisTicks(
  minDate: DateTime | null,
  span: number,
  labelFor: (date: DateTime) => string,
  unit: DateRangeSliderUnit = DateRangeSliderUnit.DAYS,
  labelWidthPercent: TickLabelWidthPercent | null = null
): DateRangeSliderAxisTick[] {
  const empty: DateRangeSliderAxisTick[] = [];
  if (!minDate || span <= 0) {
    return empty;
  } else {
    const step = unit === DateRangeSliderUnit.HOURS
      ? (span <= 12 ? 1 : span <= 24 ? 3 : span <= 48 ? 6 : 12)
      : (span <= 10 ? 1 : span <= 45 ? 7 : span <= 180 ? 14 : 30);
    const rawCount = Math.floor(span / step);
    const values = Array.from({length: rawCount + 1}, (_, index) => index * step);
    const withEnd = values[values.length - 1] === span ? values : [...values, span];
    const fixedWidthPercent = unit === DateRangeSliderUnit.HOURS ? HOUR_TICK_WIDTH_PERCENT : DATE_TICK_WIDTH_PERCENT;
    const widthPercent: TickLabelWidthPercent = labelWidthPercent || (() => fixedWidthPercent);
    const kept = withEnd.reduce((ticks: DateRangeSliderAxisTick[], value: number) => {
      const percent = (value / span) * 100;
      const candidate: DateRangeSliderAxisTick = {
        value,
        percent,
        label: labelFor(minDate.plus({[unit]: value})),
        start: value === 0,
        end: value === span
      };
      if (ticks.length === 0) {
        return [candidate];
      } else if (tickLabelsOverlap(ticks[ticks.length - 1], candidate, widthPercent)) {
        if (value === span) {
          const lastSafeIndex = ticks.reduce((safe, tick, index) => {
            if (index === 0) {
              return 0;
            } else if (tickLabelsOverlap(tick, candidate, widthPercent)) {
              return safe;
            } else {
              return index;
            }
          }, 0);
          return [...ticks.slice(0, lastSafeIndex + 1), candidate];
        } else {
          return ticks;
        }
      } else {
        return [...ticks, candidate];
      }
    }, empty);
    return kept.map((tick, index) => ({
      ...tick,
      start: index === 0,
      end: index === kept.length - 1
    }));
  }
}

@Component({
  selector: "app-date-range-slider",
  imports: [FormsModule, FontAwesomeModule, PresetSelect],
  template: `
    <div class="date-range-slider" [class.with-presets]="showPresets">
      @if (showPresets) {
        <div class="date-range-preset-wrapper">
          <app-preset-select [items]="presets" [selected]="selectedPreset"
                             placeholder="Custom range" (selectedChange)="applyPreset($event)"/>
        </div>
      }
      <div class="date-range-slider-body">
        <div class="d-flex justify-content-between align-items-center mb-1 gap-2 flex-wrap">
          <div class="range-label">
            <fa-icon [icon]="faCalendar" class="me-2"/>
            <span class="date-label">Date Range</span>
            <span class="ms-2">From <strong>{{ fromDateDisplay }}</strong></span>
          </div>
          <div class="range-label text-end">
            To <strong>{{ toDateDisplay }}</strong>
          </div>
        </div>

        <div class="range-slider-container pb-0">
          <div class="slider-ticks" aria-hidden="true" #sliderTicks>
            @for (tick of axisTicks; track tick.value) {
              <span class="slider-tick"
                    [class.tick-start]="tick.start"
                    [class.tick-end]="tick.end"
                    [style.left.%]="tick.percent">{{ tick.label }}</span>
            }
          </div>
          <div class="range-slider-row">
            <div class="slider-wrapper">
              <input
                type="range"
                class="range-slider range-from"
                [min]="minValue"
                [max]="maxValue"
                [disabled]="disabled"
                [style.z-index]="fromThumbZIndex"
                [(ngModel)]="fromValue"
                (ngModelChange)="onFromChange()"
                step="1"/>
              <input
                type="range"
                class="range-slider range-to"
                [min]="minValue"
                [max]="maxValue"
                [disabled]="disabled"
                [(ngModel)]="toValue"
                (ngModelChange)="onToChange()"
                step="1"/>
              <div class="slider-track">
                <div class="slider-fill" [style.left.%]="fillLeft" [style.width.%]="fillWidth"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host
      display: block
      width: 100%

    .date-range-slider.with-presets
      display: flex
      flex-direction: column
      align-items: stretch
      gap: var(--space-3, 12px)

    .date-range-preset-wrapper
      width: 100%
      min-width: 0

    .date-range-slider-body
      width: 100%
      min-width: 0

    :host ::ng-deep .date-range-preset-wrapper .ng-option
      white-space: normal

    .date-range-slider
      .date-label
        font-weight: 600
        font-size: 0.9rem
        color: var(--ramblers-colour-black)

      .range-labels
        display: flex
        justify-content: space-between
        align-items: center
        gap: 0.5rem

      .range-label
        font-weight: 600
        letter-spacing: 0.02em
        font-size: 0.8rem
        color: #6c757d
        white-space: nowrap
        strong
          font-size: 0.95rem
          color: var(--ramblers-colour-black)

      .range-slider-container
        position: relative
        padding: 0

      .slider-ticks
        position: relative
        height: 1.15rem
        margin-bottom: 0.35rem

      .slider-tick
        position: absolute
        top: 0
        transform: translateX(-50%)
        white-space: nowrap
        font-size: 0.75rem
        line-height: 1.15rem
        color: #6c757d
        pointer-events: none

      .slider-tick.tick-start
        transform: translateX(0)

      .slider-tick.tick-end
        transform: translateX(-100%)

      .range-slider-row
        display: flex
        align-items: center
        gap: 1rem

      .slider-wrapper
        position: relative
        flex: 1
        height: 6px

      .slider-track
        position: absolute
        top: 50%
        left: 0
        right: 0
        height: 6px
        background-color: #dee2e6
        border-radius: 3px
        transform: translateY(-50%)
        pointer-events: none

      .slider-fill
        position: absolute
        height: 100%
        background-color: var(--ramblers-colour-sunrise)
        border-radius: 3px
        transition: all 0.1s ease

      .range-slider
        position: absolute
        width: 100%
        height: 6px
        top: 50%
        transform: translateY(-50%)
        -webkit-appearance: none
        appearance: none
        background: transparent
        outline: none
        pointer-events: none

      .range-slider::-webkit-slider-thumb
        -webkit-appearance: none
        appearance: none
        width: 20px
        height: 20px
        background: var(--ramblers-colour-sunrise)
        border: 2px solid #fff
        border-radius: 50%
        cursor: pointer
        pointer-events: auto
        box-shadow: 0 2px 4px rgba(0,0,0,0.2)
        position: relative
        z-index: 3

      .range-slider::-moz-range-thumb
        width: 20px
        height: 20px
        background: var(--ramblers-colour-sunrise)
        border: 2px solid #fff
        border-radius: 50%
        cursor: pointer
        pointer-events: auto
        box-shadow: 0 2px 4px rgba(0,0,0,0.2)

      .range-slider.range-from
        z-index: 3

      .range-slider.range-to
        z-index: 4

      .range-slider::-webkit-slider-thumb:hover,
      .range-slider::-moz-range-thumb:hover
        background: var(--ramblers-colour-sunrise-hover-background)

    @media (max-width: 768px)
      .date-range-slider
        width: 100%
        > .mb-1 > .d-flex
          flex-direction: column
          align-items: stretch !important
          gap: var(--space-1)
        .range-label.text-end
          text-align: left !important
        .range-slider-row
          display: block
          width: 100%
        .slider-wrapper
          width: 100%
          margin: var(--space-2) 0

  `]
})
export class DateRangeSlider implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @ViewChild("sliderTicks") private sliderTicks?: ElementRef<HTMLElement>;
  private document = inject(DOCUMENT);
  private zone = inject(NgZone);
  private axisWidthPx = 0;
  private axisResizeObserver: ResizeObserver | null = null;
  private labelMeasureContext: CanvasRenderingContext2D | null = null;
  private dateUtils = inject(DateUtilsService);
  private initialized = false;
  private rangeInputSet = false;
  private pendingExternalRange: DateRange | null = null;
  private rangeChangeSubject = new Subject<DateRange>();
  private rangeChangeSubscription = this.rangeChangeSubject
    .pipe(debounceTime(300))
    .subscribe(range => this.rangeChange.emit(range));

  @Input() minDate?: DateTime;
  @Input() maxDate?: DateTime;
  @Input()
  set range(value: DateRange | null | undefined) {
    const next = value ?? null;
    const unchanged = this.rangeInputSet
      && next?.from === this.pendingExternalRange?.from
      && next?.to === this.pendingExternalRange?.to;
    this.rangeInputSet = true;
    this.pendingExternalRange = next;
    if (this.initialized && !unchanged) {
      this.applyExternalRange();
    }
  }
  @Output() rangeChange = new EventEmitter<DateRange>();
  @Output() presetChange = new EventEmitter<DateRangeSliderPreset>();
  showPresets = false;
  disabled = false;

  @Input("showPresets") set showPresetsValue(value: boolean) {
    this.showPresets = coerceBooleanProperty(value);
  }

  @Input({alias: "disabled"}) set disabledValue(value: boolean) {
    this.disabled = coerceBooleanProperty(value);
  }

  @Input() presets: DateRangeSliderPreset[] = DATE_RANGE_SLIDER_PRESETS;
  @Input() selectedPreset: DateRangeSliderPreset = null;

  faCalendar = faCalendar;

  minValue = 0;
  maxValue = 365;
  fromValue = 0;
  toValue = 30;
  axisTicks: DateRangeSliderAxisTick[] = [];
  private ignoreViewChanges = 0;

  ngOnInit() {
    this.configureBounds();
    this.initialized = true;
    if (this.rangeInputSet) {
      this.applyExternalRange();
    } else {
      this.clearRange(false);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.initialized && (this.boundChanged(changes["minDate"]) || this.boundChanged(changes["maxDate"]))) {
      this.configureBounds();
      if (this.rangeInputSet) {
        this.applyExternalRange();
      } else {
        this.clearRange(false);
      }
    }
  }

  private boundChanged(change: SimpleChanges[string]): boolean {
    return !!change && change.previousValue?.valueOf() !== change.currentValue?.valueOf();
  }

  get fromDateDisplay(): string {
    return this.displayForOffset(this.fromValue);
  }

  get toDateDisplay(): string {
    return this.displayForOffset(this.toValue);
  }

  private get sliderUnit(): DateRangeSliderUnit {
    if (!this.minDate || !this.maxDate) {
      return DateRangeSliderUnit.DAYS;
    } else if (this.maxDate.diff(this.minDate, "hours").hours <= 48) {
      return DateRangeSliderUnit.HOURS;
    } else {
      return DateRangeSliderUnit.DAYS;
    }
  }

  private get displayFormat(): UIDateFormat {
    if (this.sliderUnit === DateRangeSliderUnit.HOURS) {
      return UIDateFormat.DAY_MONTH_YEAR_ABBREVIATED_TIME;
    } else {
      return UIDateFormat.DAY_MONTH_YEAR_ABBREVIATED;
    }
  }

  private get axisLabelFormat(): UIDateFormat {
    if (this.sliderUnit === DateRangeSliderUnit.HOURS) {
      return UIDateFormat.RAMBLERS_TIME;
    } else {
      return UIDateFormat.DAY_MONTH_YEAR_ABBREVIATED;
    }
  }

  private displayForOffset(offset: number): string {
    const date = this.minDate?.plus({[this.sliderUnit]: offset});
    if (date) {
      return this.dateUtils.asString(date, undefined, this.displayFormat);
    } else {
      return "";
    }
  }

  get fillLeft(): number {
    return (this.fromValue / this.maxValue) * 100;
  }

  get fillWidth(): number {
    return ((this.toValue - this.fromValue) / this.maxValue) * 100;
  }

  get fromThumbZIndex(): number {
    return this.fromValue > this.maxValue / 2 ? 5 : 3;
  }

  onFromChange() {
    if (this.ignoreViewChanges === 0) {
      if (this.fromValue > this.toValue) {
        this.fromValue = this.toValue;
      }
      this.clearSelectedPreset();
      this.emitChange();
    }
  }

  onToChange() {
    if (this.ignoreViewChanges === 0) {
      if (this.toValue < this.fromValue) {
        this.toValue = this.fromValue;
      }
      this.clearSelectedPreset();
      this.emitChange();
    }
  }

  setRange(range: DateRange, emit = true) {
    this.runWithoutViewChange(() => {
      const fromDate = this.dateUtils.asDateTime(range.from);
      const toDate = this.dateUtils.asDateTime(range.to);
      const boundedFrom = fromDate < this.minDate ? this.minDate : fromDate;
      const boundedTo = toDate > this.maxDate ? this.maxDate : toDate;

      this.fromValue = Math.max(0, Math.floor(boundedFrom.diff(this.minDate!, this.sliderUnit)[this.sliderUnit]));
      this.toValue = Math.max(this.fromValue, Math.floor(boundedTo.diff(this.minDate!, this.sliderUnit)[this.sliderUnit]));
      if (emit) {
        this.emitChange();
      }
    });
  }

  clearRange(emit = true) {
    this.runWithoutViewChange(() => {
      this.fromValue = this.minValue;
      this.toValue = this.maxValue;
      if (emit) {
        this.emitChange();
      }
    });
  }

  applyPreset(preset: DateRangeSliderPreset): void {
    this.selectedPreset = preset;
    this.presetChange.emit(preset);
    if (preset?.relativeDateRange) {
      const bounds = relativeDateRangeBounds(preset.relativeDateRange, this.dateUtils.dateTimeNow());
      this.runWithoutViewChange(() => {
        this.minDate = bounds.from;
        this.maxDate = bounds.to;
        this.configureBounds();
        this.fromValue = 0;
        this.toValue = this.maxValue;
      });
      this.rangeChange.emit({from: bounds.from.toMillis(), to: bounds.to.toMillis()});
    }
  }

  private clearSelectedPreset() {
    if (this.selectedPreset) {
      this.selectedPreset = null;
      this.presetChange.emit(null);
    }
  }

  private applyExternalRange() {
    if (this.pendingExternalRange) {
      this.setRange(this.pendingExternalRange, false);
    } else {
      this.clearRange(false);
    }
  }

  private emitChange() {
    const lowValue = Math.min(this.fromValue, this.toValue);
    const highValue = Math.max(this.fromValue, this.toValue);
    const fromDate = this.minDate?.plus({[this.sliderUnit]: lowValue});
    const toDate = this.minDate?.plus({[this.sliderUnit]: highValue});

    if (fromDate && toDate) {
      this.rangeChangeSubject.next({
        from: fromDate.toMillis(),
        to: toDate.toMillis()
      });
    }
  }

  ngAfterViewInit() {
    const ResizeObserverType = this.document.defaultView?.ResizeObserver;
    const element = this.sliderTicks?.nativeElement;
    if (ResizeObserverType && element) {
      this.axisResizeObserver = new ResizeObserverType(entries => {
        const width = entries[0]?.contentRect?.width || 0;
        if (Math.round(width) !== Math.round(this.axisWidthPx)) {
          this.zone.run(() => {
            this.axisWidthPx = width;
            this.refreshAxisTicks();
          });
        }
      });
      this.axisResizeObserver.observe(element);
    }
  }

  ngOnDestroy() {
    this.rangeChangeSubscription.unsubscribe();
    this.axisResizeObserver?.disconnect();
  }

  private tickLabelPx(label: string): number {
    const element = this.sliderTicks?.nativeElement;
    const context = this.labelMeasureContext || this.document.createElement("canvas").getContext("2d");
    this.labelMeasureContext = context;
    if (context && element) {
      const style = this.document.defaultView.getComputedStyle(element.querySelector(".slider-tick") || element);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return context.measureText(label).width;
    } else {
      return 0;
    }
  }

  private refreshAxisTicks() {
    this.axisTicks = dateRangeSliderAxisTicks(this.minDate, this.maxValue, date =>
      this.dateUtils.asString(date, undefined, this.axisLabelFormat), this.sliderUnit,
      measuredTickLabelWidthPercent(label => this.tickLabelPx(label), this.axisWidthPx));
  }

  private runWithoutViewChange(action: () => void) {
    this.ignoreViewChanges = this.ignoreViewChanges + 1;
    action();
    queueMicrotask(() => {
      this.ignoreViewChanges = this.ignoreViewChanges - 1;
    });
  }

  private configureBounds() {
    const fallback = this.dateUtils.dateTimeNow().startOf("day");
    if (!this.minDate) {
      this.minDate = fallback;
    }
    if (!this.maxDate) {
      this.maxDate = this.minDate.plus({ years: 2 });
    }
    if (this.maxDate < this.minDate) {
      this.maxDate = this.minDate.plus({ days: 1 });
    }
    const totalDays = Math.max(0, Math.ceil(this.maxDate.diff(this.minDate, "days").days));
    const totalHours = Math.max(0, Math.ceil(this.maxDate.diff(this.minDate, "hours").hours));
    this.maxValue = this.sliderUnit === DateRangeSliderUnit.HOURS ? Math.max(1, totalHours) : totalDays;
    this.refreshAxisTicks();
    this.runWithoutViewChange(() => {
      this.fromValue = Math.min(this.fromValue, this.maxValue);
      this.toValue = Math.max(this.fromValue, Math.min(this.toValue, this.maxValue));
    });
  }
}
