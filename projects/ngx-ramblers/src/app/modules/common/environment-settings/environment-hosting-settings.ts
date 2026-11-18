import { Component, inject, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription } from "rxjs";
import {
  EnvironmentConfig,
  EnvironmentHostingSortField,
  EnvironmentsConfig,
  FLY_MACHINE_MODE_LABELS,
  FLY_MACHINE_MODES,
  FlyMachineMode
} from "../../../models/environment-config.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { ASCENDING, DESCENDING } from "../../../models/table-filtering.model";
import { SortableTableComponent } from "../sortable-table/sortable-table.component";
import { SortableTableCellDirective } from "../sortable-table/sortable-table-cell.directive";
import { SortableTableColumn, SortableTableSortState } from "../sortable-table/sortable-table.model";

@Component({
  selector: "app-environment-hosting-settings",
  imports: [FormsModule, SortableTableComponent, SortableTableCellDirective],
  template: `
    <div class="row thumbnail-heading-frame">
      <div class="thumbnail-heading">Hosting</div>
      <div class="col-sm-12">
        <p class="small text-muted">
          <strong>Fly machines:</strong> Always on keeps the site running all the time. Sleep when idle suspends the machine when nobody is using it, so it costs almost nothing, and the first visit after a quiet spell takes a few seconds while it wakes. Mail (IMAP/SMTP) on a sleeping site wakes the same way, and scheduled jobs on that site do not run while it sleeps.
          The change is applied the next time the site is deployed.
          <strong>Include in estate deploys</strong> decides whether deploy-to-all updates the site. Sleeping sites should stay included so they keep getting new versions.
        </p>
        <app-sortable-table
          [columns]="columns"
          [rows]="config.environments"
          [defaultSortKey]="sortKey"
          [defaultSortDirection]="sortDirection"
          [trackBy]="trackEnvironment"
          emptyMessage="No environments in platform configuration."
          (sortChange)="sortChanged($event)">
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.ENVIRONMENT" let-row>
            <strong>{{ row.environment }}</strong>
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.FLY_APP" let-row>
            <code>{{ row.flyio?.appName }}</code>
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.CUSTOM_DOMAIN" let-row>
            {{ customDomains(row) }}
          </ng-template>
          <ng-template [appSortableTableCell]="EnvironmentHostingSortField.FLY_MACHINES" let-row>
            <select class="form-select form-select-sm"
                    [attr.aria-label]="'Fly machines for ' + row.environment"
                    [ngModel]="flyMachines(row)"
                    (ngModelChange)="row.flyMachines = $event"
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
        </app-sortable-table>
      </div>
    </div>
  `
})
export class EnvironmentHostingSettings implements OnInit, OnDestroy {
  private activatedRoute = inject(ActivatedRoute);
  private router = inject(Router);
  private subscriptions: Subscription[] = [];

  @Input() config!: EnvironmentsConfig;

  protected readonly EnvironmentHostingSortField = EnvironmentHostingSortField;
  protected readonly FLY_MACHINE_MODE_LABELS = FLY_MACHINE_MODE_LABELS;
  protected readonly flyMachineModes = FLY_MACHINE_MODES;

  sortKey: string = EnvironmentHostingSortField.ENVIRONMENT;
  sortDirection: string = ASCENDING;

  columns: SortableTableColumn<EnvironmentConfig>[] = [
    {key: EnvironmentHostingSortField.ENVIRONMENT, label: "Environment", sortKey: EnvironmentHostingSortField.ENVIRONMENT},
    {key: EnvironmentHostingSortField.FLY_APP, label: "Fly app", sortKey: EnvironmentHostingSortField.FLY_APP},
    {key: EnvironmentHostingSortField.CUSTOM_DOMAIN, label: "Custom domain", sortKey: EnvironmentHostingSortField.CUSTOM_DOMAIN},
    {key: EnvironmentHostingSortField.FLY_MACHINES, label: "Fly machines", sortKey: EnvironmentHostingSortField.FLY_MACHINES, width: "12rem"},
    {key: EnvironmentHostingSortField.ESTATE_DEPLOY, label: "Include in estate deploys", sortKey: EnvironmentHostingSortField.ESTATE_DEPLOY}
  ];

  ngOnInit() {
    this.subscriptions.push(this.activatedRoute.queryParams.subscribe(params => {
      this.sortKey = params[StoredValue.HOSTING_SORT] || EnvironmentHostingSortField.ENVIRONMENT;
      this.sortDirection = params[StoredValue.HOSTING_SORT_ORDER] === DESCENDING ? DESCENDING : ASCENDING;
    }));
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  trackEnvironment = (_index: number, row: EnvironmentConfig) => row.environment;

  flyMachines(row: EnvironmentConfig): FlyMachineMode {
    return row.flyMachines || FlyMachineMode.ALWAYS_ON;
  }

  customDomains(row: EnvironmentConfig): string {
    return (row.customDomains || []).map(domain => domain.hostname).join(", ");
  }

  sortChanged(state: SortableTableSortState) {
    this.sortKey = state.key || EnvironmentHostingSortField.ENVIRONMENT;
    this.sortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        [StoredValue.HOSTING_SORT]: this.sortKey,
        [StoredValue.HOSTING_SORT_ORDER]: this.sortDirection
      },
      queryParamsHandling: "merge"
    });
  }
}
