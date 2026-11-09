import { Component, inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { NgSelectComponent } from "@ng-select/ng-select";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation, faRefresh, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { NgxLoggerLevel } from "ngx-logger";
import { DateTime } from "luxon";
import { firstValueFrom, Subscription } from "rxjs";
import { isArray, isString } from "es-toolkit/compat";
import { SessionLogsComponent } from "../../../../shared/components/session-logs";
import { DateRange, DateRangeSlider } from "../../../../components/date-range-slider/date-range-slider";
import { dateRangeSliderPresets } from "../../../../models/date.model";
import { DateDirection, relativeDateRangeBounds } from "../../../../models/search.model";
import { StoredValue } from "../../../../models/ui-actions.model";
import { AdminPlatformPath } from "../../../../models/admin-route-paths.model";
import { SystemLogLine, stripAnsi } from "../../../../models/system-log.model";
import { MemoryUsageResponse } from "../../../../models/health.model";
import { DateUtilsService } from "../../../../services/date-utils.service";
import { Logger, LoggerFactory } from "../../../../services/logger-factory.service";

@Component({
  selector: "app-system-logs-settings",
  imports: [FormsModule, NgSelectComponent, SessionLogsComponent, DateRangeSlider, FontAwesomeModule, RouterLink],
  styles: [`
    :host ::ng-deep .system-log-prefix-select
      font-size: 0.8rem
      width: 100%
    :host ::ng-deep .system-log-prefix-select .ng-select-container
      min-height: 32px
    :host ::ng-deep .system-log-prefix-select .ng-value
      font-size: 0.75rem
  `],
  template: `
    <div class="row thumbnail-heading-frame">
      <div class="thumbnail-heading">Server log</div>
      <div class="col-12 pt-3">
        <p class="small text-muted">{{ logSourceCopy() }}
          @if (!environmentName) {
            Other sites: open
            <a [routerLink]="'/' + environmentSetupPath">Environment Configuration</a>
            and pick the environment there.
          }
        </p>
        <div class="d-flex flex-wrap align-items-end gap-3 mb-3">
          <div class="form-group flex-grow-1 mb-0">
            <app-date-range-slider
              showPresets
              [presets]="pastPresets"
              [minDate]="logMinDate"
              [maxDate]="logMaxDate"
              [range]="logDateRange"
              [disabled]="busy"
              (rangeChange)="onLogDateRangeChange($event)"/>
          </div>
          <div class="form-group mb-0">
            <button type="button" class="btn btn-primary" [disabled]="busy" (click)="refreshLogs()">
              <fa-icon [icon]="busy ? faSpinner : faRefresh" [animation]="busy ? 'spin' : null" class="me-1"/>
              Refresh
            </button>
          </div>
        </div>
        <ng-select class="system-log-prefix-select mb-3"
                   name="systemLogPrefixes"
                   appearance="outline"
                   [items]="prefixOptions"
                   [multiple]="true"
                   [addTag]="true"
                   [clearable]="true"
                   [searchable]="true"
                   [closeOnSelect]="false"
                   [appendTo]="'body'"
                   [dropdownPosition]="'bottom'"
                   placeholder="Prefix"
                   [(ngModel)]="selectedPrefixes"
                   (ngModelChange)="onPrefixesChange($event)">
        </ng-select>
        @if (errorMessage) {
          <div class="alert alert-danger d-flex align-items-start" role="alert">
            <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1 flex-shrink-0"/>
            <div>
              <strong class="d-block">Could not load logs</strong>
              {{ errorMessage }}
            </div>
          </div>
        }
        <app-session-logs
          [messages]="filteredLogMessages()"
          [live]="true"
          [waitingMessage]="waitingMessage()"/>
      </div>
    </div>
  `
})
export class SystemLogsSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() environmentName: string | null = null;
  private logger = inject(LoggerFactory).createLogger("SystemLogsSettingsComponent", NgxLoggerLevel.ERROR);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dateUtils = inject(DateUtilsService);
  private http = inject(HttpClient);
  private subscriptions: Subscription[] = [];
  protected selectedPrefixes: string[] = [];
  protected prefixOptions: string[] = [];
  protected logLines: SystemLogLine[] = [];
  protected selectedEnvironment = "";
  protected currentEnvironment = "";
  protected busy = false;
  protected errorMessage: string | null = null;
  protected logMinDate: DateTime;
  protected logMaxDate: DateTime;
  protected logDateRange: DateRange;
  protected readonly pastPresets = dateRangeSliderPresets({direction: DateDirection.PAST, recent: true});
  protected readonly lastDayPreset = this.pastPresets.find(preset => preset.relativeDateRange?.duration?.hours === 24) ?? null;
  protected readonly faRefresh = faRefresh;
  protected readonly faSpinner = faSpinner;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly environmentSetupPath = AdminPlatformPath.ENVIRONMENT_MANAGEMENT_SETUP;

  ngOnInit(): void {
    this.initialiseDateRange();
    this.subscriptions.push(this.route.queryParams.subscribe(params => {
      const next = this.prefixesFromQuery(params[StoredValue.SYSTEM_LOG_FILTER]);
      if (next.join(",") !== this.selectedPrefixes.join(",")) {
        this.selectedPrefixes = next;
      }
      this.applyDateParams(params[StoredValue.START_DATE], params[StoredValue.END_DATE]);
    }));
    void this.startLogs();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["environmentName"] && !changes["environmentName"].firstChange) {
      this.selectedEnvironment = this.environmentName || this.currentEnvironment;
      void this.connectLogs();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  logSourceCopy(): string {
    if (this.environmentName) {
      return `Newest first. Fly logs for ${this.environmentName} over the selected date range.`;
    } else if (this.selectedEnvironment) {
      return `Newest first. Fly logs for ${this.selectedEnvironment} over the selected date range.`;
    } else {
      return "Newest first. Fly logs over the selected date range.";
    }
  }

  waitingMessage(): string {
    if (this.busy) {
      return "Loading log lines from Fly.";
    } else {
      return "No log lines in this date range.";
    }
  }

  onPrefixesChange(value: string[]): void {
    this.selectedPrefixes = value || [];
    this.navigateQuery({
      [StoredValue.SYSTEM_LOG_FILTER]: this.selectedPrefixes.length ? this.selectedPrefixes.join(",") : null
    });
  }

  onLogDateRangeChange(range: DateRange): void {
    if (range?.from !== this.logDateRange?.from || range?.to !== this.logDateRange?.to) {
      this.logDateRange = range;
      this.navigateQuery({
        [StoredValue.START_DATE]: String(range.from),
        [StoredValue.END_DATE]: String(range.to)
      });
      void this.refreshLogs();
    }
  }

  async refreshLogs(): Promise<void> {
    await this.connectLogs();
  }

  private initialiseDateRange(): void {
    const bounds = this.lastDayPreset?.relativeDateRange
      ? relativeDateRangeBounds(this.lastDayPreset.relativeDateRange, this.dateUtils.dateTimeNow())
      : null;
    if (bounds) {
      this.logMinDate = bounds.from;
      this.logMaxDate = bounds.to;
      if (!this.logDateRange) {
        this.logDateRange = {
          from: bounds.from.toMillis(),
          to: bounds.to.toMillis()
        };
      }
    }
  }

  private advanceRangeToNow(): void {
    const now = this.dateUtils.dateTimeNow();
    const to = this.logDateRange?.to || 0;
    const pinnedToEnd = this.logMaxDate && to >= this.logMaxDate.toMillis() - 1000;
    const liveCursor = to >= now.toMillis() - 3 * 60 * 60 * 1000;
    if ((pinnedToEnd || liveCursor) && this.logDateRange) {
      this.logMaxDate = now;
      this.logDateRange = {from: this.logDateRange.from, to: now.toMillis()};
      this.navigateQuery({
        [StoredValue.START_DATE]: String(this.logDateRange.from),
        [StoredValue.END_DATE]: String(this.logDateRange.to)
      });
    }
  }

  private applyDateParams(startValue: unknown, endValue: unknown): void {
    const from = this.millisFromQuery(startValue);
    const to = this.millisFromQuery(endValue);
    if (from && to && (from !== this.logDateRange?.from || to !== this.logDateRange?.to)) {
      this.logDateRange = {from, to};
    }
  }

  private millisFromQuery(value: unknown): number | null {
    if (!isString(value)) {
      return null;
    } else {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      } else {
        return null;
      }
    }
  }

  private navigateQuery(queryParams: Record<string, string | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: "merge"
    });
  }

  private refreshPrefixOptions(): void {
    const seen = new Set<string>();
    this.prefixOptions = [...this.logLines].reverse().reduce((prefixes: string[], line) => {
      if (seen.has(line.prefix)) {
        return prefixes;
      } else {
        seen.add(line.prefix);
        return [...prefixes, line.prefix];
      }
    }, []);
  }

  filteredLogMessages(): string[] {
    const needles = this.selectedPrefixes.map(prefix => prefix.trim().toLowerCase()).filter(Boolean);
    return this.logLines
      .filter(line => this.lineMatches(line, needles))
      .map(line => `${this.dateUtils.displayDateAndTime(line.at)} ${line.text}`);
  }

  private lineMatches(line: SystemLogLine, needles: string[]): boolean {
    if (needles.length === 0) {
      return true;
    } else {
      const prefix = line.prefix.toLowerCase();
      const text = stripAnsi(line.text).toLowerCase();
      return needles.some(needle => prefix === needle || prefix.startsWith(needle) || text.includes(needle));
    }
  }

  private prefixesFromQuery(value: unknown): string[] {
    if (isArray(value)) {
      return value.filter(item => isString(item) && item.trim());
    } else if (isString(value) && value.trim()) {
      return value.split(",").map(item => item.trim()).filter(Boolean);
    } else {
      return [];
    }
  }

  private async startLogs(): Promise<void> {
    try {
      const memory = await firstValueFrom(this.http.get<MemoryUsageResponse>("/api/health/memory"));
      this.currentEnvironment = memory.environment;
      this.selectedEnvironment = this.environmentName || this.currentEnvironment;
    } catch (error) {
      this.logger.error("current environment unavailable:", error);
    }
    await this.connectLogs();
  }

  private async connectLogs(): Promise<void> {
    await this.refreshRemoteLogs();
  }

  private async refreshRemoteLogs(): Promise<void> {
    this.advanceRangeToNow();
    this.busy = true;
    this.errorMessage = null;
    try {
      const response = await firstValueFrom(this.http.get<{lines: SystemLogLine[]}>(
        "/api/health/system-logs",
        {
          params: {
            environment: this.selectedEnvironment || "",
            from: String(this.logDateRange.from),
            to: String(this.logDateRange.to)
          }
        }
      ));
      this.logLines = response.lines || [];
      this.refreshPrefixOptions();
    } catch (error) {
      this.logger.error("remote system logs unavailable:", error);
      this.errorMessage = this.errorText(error);
      this.logLines = [];
      this.prefixOptions = [];
    } finally {
      this.busy = false;
    }
  }

  private errorText(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error;
      if (body && isString(body.error)) {
        return body.error;
      } else if (isString(error.message)) {
        return error.message;
      } else {
        return "Failed to query system logs";
      }
    } else if (error instanceof Error) {
      return error.message;
    } else {
      return "Failed to query system logs";
    }
  }

}
