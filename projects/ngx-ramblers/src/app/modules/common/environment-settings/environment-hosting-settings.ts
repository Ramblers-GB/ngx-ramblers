import { Component, inject, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NgSelectComponent } from "@ng-select/ng-select";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription } from "rxjs";
import {
  ENVIRONMENT_SITE_STATUS_LABELS,
  ENVIRONMENT_SITE_STATUSES,
  EnvironmentConfig,
  EnvironmentHostingSortField,
  EnvironmentSiteStatus,
  EnvironmentsConfig,
  FLY_MACHINE_MODE_LABELS,
  FLY_MACHINE_MODES,
  FlyMachineMode
} from "../../../models/environment-config.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { flyAppUrl } from "../../../functions/fly-app-url";
import { TypedKeyValue } from "../../../functions/enums";
import { ConsoleAccessLinksComponent } from "../console-access-links/console-access-links";
import { ConsoleAccessResolvedUrlInfo, ConsoleAccessUrlIconKey } from "../../../models/environment-setup.model";
import { ASCENDING, DESCENDING } from "../../../models/table-filtering.model";
import { SortableTableComponent } from "../sortable-table/sortable-table.component";
import { SortableTableCellDirective, SortableTableExpandedRowDirective } from "../sortable-table/sortable-table-cell.directive";
import { SortableTableAlignment, SortableTableColumn, SortableTableSortState } from "../sortable-table/sortable-table.model";

@Component({
  selector: "app-environment-hosting-settings",
  imports: [FormsModule, NgSelectComponent, SortableTableComponent, SortableTableCellDirective, SortableTableExpandedRowDirective, ConsoleAccessLinksComponent],
  styles: [`
    .hosting-environment-detail
      font-size: 0.8rem
      line-height: 1.3
      overflow-wrap: anywhere

    :host ::ng-deep .hosting-environment-detail .console-table-links
      flex-direction: column
      align-items: flex-start
      gap: 0.15rem
      margin-top: 0.25rem
  `],
  template: `
    <div class="row thumbnail-heading-frame">
      <div class="thumbnail-heading">Hosting</div>
      <div class="col-sm-12">
        <p class="small text-muted">
          <strong>Site status</strong> and <strong>Notes</strong> record what each environment is for and where it stands.
          <strong>Fly machine:</strong> Sleep when idle suspends the site while nobody is using it, and the first visit afterwards takes a second or two. Scheduled jobs on a sleeping site, such as campaign releases or reminders, run when it next wakes rather than on time, so keep sites that rely on them Always on. The change applies on the site's next deploy.
          <strong>Estate deploys</strong> decides whether deploy-to-all updates the site.
        </p>
        <div class="row g-2 align-items-end mb-4">
          <div class="col-12 col-md">
            <label for="hosting-site-status-filter">Site status</label>
            <ng-select id="hosting-site-status-filter"
                       [items]="siteStatusOptions"
                       bindValue="key"
                       bindLabel="value"
                       [multiple]="true"
                       [closeOnSelect]="false"
                       [clearable]="true"
                       [searchable]="false"
                       placeholder="All statuses"
                       [ngModel]="selectedStatuses"
                       [ngModelOptions]="{standalone: true}"
                       (ngModelChange)="siteStatusFilterChanged($event)"/>
          </div>
          <div class="col-12 col-md-3">
            <label for="hosting-fly-machine-filter">Fly machine</label>
            <ng-select id="hosting-fly-machine-filter"
                       [items]="flyMachineOptions"
                       bindValue="key"
                       bindLabel="value"
                       [clearable]="true"
                       [searchable]="false"
                       placeholder="Any"
                       [ngModel]="flyMachineFilter"
                       [ngModelOptions]="{standalone: true}"
                       (ngModelChange)="flyMachineFilterChanged($event)"/>
          </div>
          <div class="col-12 col-md-auto pb-2 text-muted">Showing {{ filteredEnvironments.length }} of {{ allEnvironments().length }}</div>
        </div>
        <app-sortable-table
          [columns]="columns"
          [rows]="filteredEnvironments"
          [defaultSortKey]="sortKey"
          [defaultSortDirection]="sortDirection"
          [trackBy]="trackEnvironment"
          [expandedWhen]="alwaysShowNotes"
          emptyMessage="No environments match these filters."
          (sortChange)="sortChanged($event)">
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.ENVIRONMENT" let-row>
            <div class="fw-bold">{{ row.environment }}</div>
            <app-console-access-links class="hosting-environment-detail" [links]="environmentLinks(row)" [showEmpty]="false"/>
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.SITE_STATUS" let-row>
            <select class="form-select form-select-sm"
                    [attr.aria-label]="'Site status for ' + row.environment"
                    [ngModel]="row.siteStatus || null"
                    (ngModelChange)="row.siteStatus = $event || undefined; applyFilters()"
                    [name]="'siteStatus-' + row.environment">
              <option [ngValue]="null">Not set</option>
              @for (status of siteStatuses; track status) {
                <option [ngValue]="status">{{ ENVIRONMENT_SITE_STATUS_LABELS[status] }}</option>
              }
            </select>
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.FLY_MACHINES" let-row>
            <select class="form-select form-select-sm"
                    [attr.aria-label]="'Fly machine for ' + row.environment"
                    [ngModel]="flyMachines(row)"
                    (ngModelChange)="row.flyMachines = $event; applyFilters()"
                    [name]="'flyMachines-' + row.environment">
              @for (mode of flyMachineModes; track mode) {
                <option [ngValue]="mode">{{ FLY_MACHINE_MODE_LABELS[mode] }}</option>
              }
            </select>
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.ESTATE_DEPLOY" let-row>
            <input type="checkbox"
                   class="form-check-input"
                   [attr.aria-label]="'Include ' + row.environment + ' in estate deploys'"
                   [ngModel]="row.estateDeploy !== false"
                   (ngModelChange)="row.estateDeploy = $event"
                   [name]="'estateDeploy-' + row.environment">
          </ng-template>
          <ng-template appSortableTableExpandedRow let-row>
            <textarea class="form-control form-control-sm"
                      rows="2"
                      placeholder="Notes"
                      [attr.aria-label]="'Notes for ' + row.environment"
                      [ngModel]="row.siteNotes || ''"
                      (ngModelChange)="row.siteNotes = $event"
                      [name]="'siteNotes-' + row.environment"></textarea>
          </ng-template>
        </app-sortable-table>
      </div>
    </div>
  `
})
export class EnvironmentHostingSettings implements OnInit, OnDestroy {
  private activatedRoute = inject(ActivatedRoute);
  private router = inject(Router);
  private subscriptions: Subscription[] = [];

  private configValue: EnvironmentsConfig = {environments: []};
  selectedStatuses: EnvironmentSiteStatus[] = [];
  flyMachineFilter: FlyMachineMode | null = null;
  filteredEnvironments: EnvironmentConfig[] = [];
  siteStatusOptions: TypedKeyValue<EnvironmentSiteStatus, string>[] = [];
  readonly flyMachineOptions: TypedKeyValue<FlyMachineMode, string>[] = FLY_MACHINE_MODES.map(mode => ({key: mode, value: FLY_MACHINE_MODE_LABELS[mode]}));

  @Input() set config(value: EnvironmentsConfig) {
    this.configValue = value || {environments: []};
    this.applyFilters();
  }

  get config(): EnvironmentsConfig {
    return this.configValue;
  }

  protected readonly EnvironmentHostingSortField = EnvironmentHostingSortField;
  protected readonly FLY_MACHINE_MODE_LABELS = FLY_MACHINE_MODE_LABELS;
  protected readonly flyMachineModes = FLY_MACHINE_MODES;
  protected readonly ENVIRONMENT_SITE_STATUS_LABELS = ENVIRONMENT_SITE_STATUS_LABELS;
  protected readonly siteStatuses = ENVIRONMENT_SITE_STATUSES;

  sortKey: string = EnvironmentHostingSortField.ENVIRONMENT;
  sortDirection: string = ASCENDING;

  columns: SortableTableColumn<EnvironmentConfig>[] = [
    {key: EnvironmentHostingSortField.ENVIRONMENT, label: "Environment", sortKey: EnvironmentHostingSortField.ENVIRONMENT},
    {key: EnvironmentHostingSortField.SITE_STATUS, label: "Site status", sortKey: EnvironmentHostingSortField.SITE_STATUS, width: "13rem"},
    {key: EnvironmentHostingSortField.FLY_MACHINES, label: "Fly machine", sortKey: EnvironmentHostingSortField.FLY_MACHINES, width: "10.5rem"},
    {key: EnvironmentHostingSortField.ESTATE_DEPLOY, label: "Estate deploys", sortKey: EnvironmentHostingSortField.ESTATE_DEPLOY, width: "7rem", align: SortableTableAlignment.CENTER}
  ];

  ngOnInit() {
    this.subscriptions.push(this.activatedRoute.queryParams.subscribe(params => {
      this.sortKey = params[StoredValue.HOSTING_SORT] || EnvironmentHostingSortField.ENVIRONMENT;
      this.sortDirection = params[StoredValue.HOSTING_SORT_ORDER] === DESCENDING ? DESCENDING : ASCENDING;
      this.selectedStatuses = (params[StoredValue.HOSTING_SITE_STATUS] || "").split(",").filter(status => this.siteStatuses.includes(status as EnvironmentSiteStatus)) as EnvironmentSiteStatus[];
      this.flyMachineFilter = this.flyMachineModes.includes(params[StoredValue.HOSTING_FLY_MACHINE]) ? params[StoredValue.HOSTING_FLY_MACHINE] : null;
      this.applyFilters();
    }));
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  alwaysShowNotes = () => true;

  allEnvironments(): EnvironmentConfig[] {
    return this.configValue.environments || [];
  }

  applyFilters() {
    this.siteStatusOptions = this.siteStatuses.map(status => ({key: status, value: `${ENVIRONMENT_SITE_STATUS_LABELS[status]} (${this.statusCount(status)})`}));
    this.filteredEnvironments = this.allEnvironments().filter(environment =>
      (this.selectedStatuses.length === 0 || this.selectedStatuses.includes(environment.siteStatus))
      && (!this.flyMachineFilter || this.flyMachines(environment) === this.flyMachineFilter));
  }

  statusCount(status: EnvironmentSiteStatus): number {
    return this.allEnvironments().filter(environment => environment.siteStatus === status).length;
  }

  siteStatusFilterChanged(selected: EnvironmentSiteStatus[] | null) {
    const chosen = this.siteStatuses.filter(candidate => (selected || []).includes(candidate));
    this.updateQueryParams({[StoredValue.HOSTING_SITE_STATUS]: chosen.length ? chosen.join(",") : null});
  }

  flyMachineFilterChanged(mode: FlyMachineMode | null) {
    this.updateQueryParams({[StoredValue.HOSTING_FLY_MACHINE]: mode || null});
  }

  trackEnvironment = (_index: number, row: EnvironmentConfig) => row.environment;

  flyMachines(row: EnvironmentConfig): FlyMachineMode {
    return row.flyMachines || FlyMachineMode.ALWAYS_ON;
  }

  environmentLinks(row: EnvironmentConfig): ConsoleAccessResolvedUrlInfo[] {
    const appName = row.flyio?.appName || "";
    const customDomains = (row.customDomains || []).map(domain => domain.hostname).filter(hostname => !!hostname);
    const websites = customDomains.length > 0 ? customDomains : (appName ? [`${appName}.fly.dev`] : []);
    const websiteLinks = websites.map(hostname => ({label: hostname, url: `https://${hostname}`, iconKey: ConsoleAccessUrlIconKey.ZONE}));
    const flyLink = appName ? [{label: `Fly app ${appName}`, url: flyAppUrl(appName), iconKey: ConsoleAccessUrlIconKey.DASHBOARD}] : [];
    return [...websiteLinks, ...flyLink];
  }

  sortChanged(state: SortableTableSortState) {
    this.sortKey = state.key || EnvironmentHostingSortField.ENVIRONMENT;
    this.sortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    this.updateQueryParams({
      [StoredValue.HOSTING_SORT]: this.sortKey,
      [StoredValue.HOSTING_SORT_ORDER]: this.sortDirection
    });
  }

  private updateQueryParams(queryParams: Record<string, string | null>) {
    void this.router.navigate([], {relativeTo: this.activatedRoute, queryParams, queryParamsHandling: "merge"});
  }
}
