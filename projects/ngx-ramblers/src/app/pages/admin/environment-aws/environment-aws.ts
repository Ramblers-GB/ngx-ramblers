import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faArrowsRotate, faCircleExclamation, faExchangeAlt, faKey, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import { TabDirective, TabsetComponent } from "ngx-bootstrap/tabs";
import { TooltipDirective } from "ngx-bootstrap/tooltip";
import {
  AwsS3BucketRow,
  AwsS3BucketSortField,
  AwsS3EnvironmentRow,
  AwsS3EnvironmentSortField,
  AwsS3BucketKind,
  AwsS3InventoryView,
  AwsS3MigrationStatus,
  awsS3StatusBadgeClass,
  awsS3StatusLabel,
  EnvironmentAwsTab
} from "../../../models/aws-s3-inventory.model";
import { AdminPlatformPath } from "../../../models/admin-route-paths.model";
import { EnvironmentSetupTab } from "../../../models/environment-setup.model";
import { EnvironmentSettingsSubTab } from "../../../models/system.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { awsRegionLabel } from "../../../models/environment-config.model";
import { EnvironmentMigrationMode, EnvironmentMigrationTab } from "../../../models/environment-migration.model";
import { toKebabCase } from "../../../functions/strings";
import { kebabCase } from "es-toolkit/compat";
import { ASCENDING, DESCENDING } from "../../../models/table-filtering.model";
import { SortableTableColumn, SortableTableSortState } from "../../../modules/common/sortable-table/sortable-table.model";
import { SortableTableCellDirective } from "../../../modules/common/sortable-table/sortable-table-cell.directive";
import { SortableTableComponent } from "../../../modules/common/sortable-table/sortable-table.component";
import { VendorBrandMarkComponent } from "../../../modules/common/vendor-brand-mark/vendor-brand-mark.component";
import { ConsoleAccessLinksComponent } from "../../../modules/common/console-access-links/console-access-links";
import { AWS_S3_CONSOLE_URLS, ConsoleAccessUrlIconKey } from "../../../models/environment-setup.model";
import { resolveConsoleUrls } from "../../../functions/console-access-urls";
import { PageComponent } from "../../../page/page.component";
import { EnvironmentSetupService } from "../../../services/environment-setup/environment-setup.service";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { NotifierService } from "../../../services/notifier.service";
import { AlertTarget } from "../../../models/alert-target.model";
import { EnvironmentSiteLinksComponent } from "../../../modules/common/environment-site-links/environment-site-links";

@Component({
  selector: "app-environment-aws",
  imports: [
    FontAwesomeModule,
    RouterLink,
    TabsetComponent,
    TabDirective,
    PageComponent,
    SortableTableComponent,
    SortableTableCellDirective,
    VendorBrandMarkComponent,
    ConsoleAccessLinksComponent,
    EnvironmentSiteLinksComponent,
    TooltipDirective
  ],
  styles: [`
    .row-action-icon
      display: inline-flex
      align-items: center
      justify-content: center
      border: 0
      background: transparent
      padding: 0.25rem 0.4rem
      color: var(--bs-secondary-color)
      line-height: 1
      text-decoration: none
    .row-action-icon:hover, .row-action-icon:focus-visible
      color: var(--ramblers-colour-sunrise, #f9b104)
    .aws-action-links
      display: flex
      flex-direction: row
      flex-wrap: wrap
      align-items: center
      gap: 0.35rem 0.85rem
    .aws-action-link
      display: inline-flex
      align-items: center
      gap: 0.4rem
      padding: 0
      border: 0
      background: none
      color: inherit
      font-size: inherit
      line-height: 1.35
      white-space: nowrap
  `],
  template: `
    <app-page autoTitle pageTitle="AWS S3">
      @if (notifyTarget.showAlert && notifyTarget.alert) {
        <div class="alert {{ notifyTarget.alert.class }} d-flex align-items-start">
          <fa-icon [icon]="notifyTarget.alert.icon" class="me-2 mt-1"/>
          <div>
            @if (notifyTarget.alertTitle) {
              <strong>{{ notifyTarget.alertTitle }}</strong>
              <div>{{ notifyTarget.alertMessage }}</div>
            } @else {
              {{ notifyTarget.alertMessage }}
            }
          </div>
        </div>
      }
      @if (loading) {
        <div class="alert alert-warning d-flex align-items-start">
          <fa-icon [icon]="faSpinner" class="me-2 mt-1" animation="spin"/>
          <div>
            <strong>Loading buckets</strong>
            <div>Listing buckets in the Ramblers NGX account and matching them to each site.</div>
          </div>
        </div>
      }
      @if (errorMessage) {
        <div class="alert alert-danger d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
          <div>
            <strong>Could not load AWS</strong>
            <div>{{ errorMessage }}</div>
          </div>
        </div>
      }
      @if (view && view.remainingCount > 0) {
        <div class="alert alert-warning d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
          <div>
            <strong>{{ view.remainingCount }} {{ view.remainingCount === 1 ? "site still uses" : "sites still use" }} the old AWS account</strong>
            <div>{{ view.migratedCount }} already moved. Use the move icon on a site's row to move it to Ramblers storage.</div>
          </div>
        </div>
      }
      <tabset class="custom-tabset">
        <tab heading="Provisioning" [active]="activeTab === EnvironmentAwsTab.PROVISIONING" (selectTab)="selectTab(EnvironmentAwsTab.PROVISIONING)">
          <div class="row thumbnail-heading-frame mb-4">
            <div class="thumbnail-heading with-vendor-logo d-flex align-items-center gap-2">
              <app-vendor-brand-mark serviceId="aws" [sizePx]="26"/>
              <span>Ramblers NGX account</span>
            </div>
            <p class="mb-3">Each site's photos and files live in their own London bucket in this account, and nightly backups go to the shared archive bucket. Sites not moved yet are still on the old account.</p>
            <div class="row">
              <div class="col-md-6 mb-2">
                <label class="form-label">Account ID</label>
                <input class="form-control" [value]="view?.accountId || ''" readonly>
              </div>
              <div class="col-md-6 mb-2">
                <label class="form-label">Region</label>
                <input class="form-control" [value]="awsRegionLabel(view?.region)" readonly>
              </div>
              <div class="col-md-6 mb-2">
                <label class="form-label">Archive bucket</label>
                <input class="form-control" [value]="view?.archiveBucket || ''" readonly>
              </div>
              <div class="col-md-6 mb-2">
                <label class="form-label">Previous Ireland archive</label>
                <input class="form-control" [value]="view?.previousArchiveBucket || ''" readonly>
              </div>
            </div>
            <div class="aws-action-links mt-2">
              <a class="aws-action-link" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_SETUP"
                 [queryParams]="environmentSetupGlobalQueryParams">
                <fa-icon [icon]="faKey"/>
                <span>API keys</span>
              </a>
              @if (consoleHomeLinks().length) {
                <app-console-access-links class="d-inline-flex" [links]="consoleHomeLinks()" [showEmpty]="false"/>
              }
            </div>
            @if (view && !view.keysConfigured) {
              <div class="alert alert-warning d-flex align-items-start mt-3 mb-0">
                <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
                <div>
                  <strong>Setup AWS keys needed</strong>
                  <div>Add SETUP_AWS_ACCESS_KEY_ID and SETUP_AWS_SECRET_ACCESS_KEY for the Ramblers NGX account before this page can list buckets.</div>
                </div>
              </div>
            }
            @if (view?.awsError) {
              <div class="alert alert-warning d-flex align-items-start mt-3 mb-0">
                <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
                <div>
                  <strong>AWS API</strong>
                  <div>{{ view.awsError }}</div>
                </div>
              </div>
            }
          </div>
        </tab>
        <tab heading="Buckets" [active]="activeTab === EnvironmentAwsTab.BUCKETS" (selectTab)="selectTab(EnvironmentAwsTab.BUCKETS)">
          <div class="row thumbnail-heading-frame mb-4">
            <div class="thumbnail-heading">Buckets</div>
            <div class="mb-3">
              <button type="button" class="btn btn-primary" [disabled]="loading" (click)="load()">
                <fa-icon [icon]="loading ? faSpinner : faArrowsRotate" [animation]="loading ? 'spin' : undefined" class="me-1"/>{{ loading ? "Refreshing" : "Refresh" }}
              </button>
            </div>
            <app-sortable-table
              [columns]="bucketColumns"
              [rows]="view?.buckets || []"
              [defaultSortKey]="bucketSortKey"
              [defaultSortDirection]="bucketSortDirection"
              [trackBy]="trackBucket"
              filterable
              fillWindow
              [filterStoredValue]="StoredValue.AWS_BUCKET_FILTER"
              emptyMessage="No buckets listed yet. Add the Ramblers NGX setup keys, or site buckets will appear here from environment configuration."
              (sortChange)="bucketSortChanged($event)">
              <ng-template [appSortableTableCell]="AwsS3BucketSortField.NAME" let-row>
                <div>{{ row.name }}</div>
                <div class="d-flex align-items-center flex-wrap gap-2 mt-2">
                  @if (bucketConsoleLinks(row).length) {
                    <app-vendor-brand-mark serviceId="aws" [sizePx]="18" [inline]="true"/>
                  }
                  <app-console-access-links class="d-inline-flex" [links]="bucketConsoleLinks(row)" [showEmpty]="false"/>
                </div>
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3BucketSortField.REGION" let-row>
                {{ awsRegionLabel(row.region) }}
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3BucketSortField.KIND" let-row>
                {{ kindLabel(row.kind) }}
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3BucketSortField.ENVIRONMENTS" let-row>
                <app-environment-site-links [sites]="row.sites"/>
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3BucketSortField.STATUS" let-row>
                <span class="text-nowrap" [class]="awsS3StatusBadgeClass(row.status)">{{ awsS3StatusLabel(row.status) }}</span>
              </ng-template>
              <ng-template [appSortableTableCell]="'actions'" let-row>
                @if (row.migrateEnvironment) {
                  <a class="row-action-icon" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_MIGRATION"
                     [queryParams]="moveS3QueryParams(row.migrateEnvironment)"
                     tooltip="Move to Ramblers storage" container="body" aria-label="Move to Ramblers storage">
                    <fa-icon [icon]="faExchangeAlt"/>
                  </a>
                }
              </ng-template>
            </app-sortable-table>
          </div>
        </tab>
        <tab heading="Environments" [active]="activeTab === EnvironmentAwsTab.ENVIRONMENTS" (selectTab)="selectTab(EnvironmentAwsTab.ENVIRONMENTS)">
          <div class="row thumbnail-heading-frame mb-4">
            <div class="thumbnail-heading">Environments</div>
            <div class="mb-3">
              <button type="button" class="btn btn-primary" [disabled]="loading" (click)="load()">
                <fa-icon [icon]="loading ? faSpinner : faArrowsRotate" [animation]="loading ? 'spin' : undefined" class="me-1"/>{{ loading ? "Refreshing" : "Refresh" }}
              </button>
            </div>
            <app-sortable-table
              [columns]="environmentColumns"
              [rows]="view?.environments || []"
              [defaultSortKey]="environmentSortKey"
              [defaultSortDirection]="environmentSortDirection"
              [trackBy]="trackEnvironment"
              filterable
              fillWindow
              [filterStoredValue]="StoredValue.AWS_ENVIRONMENT_FILTER"
              [emptyMessage]="loading ? 'Waiting for environment data…' : 'No environments in platform configuration.'"
              (sortChange)="environmentSortChanged($event)">
              <ng-template [appSortableTableCell]="AwsS3EnvironmentSortField.ENVIRONMENT" let-row>
                <app-environment-site-links [sites]="[{environment: row.environment, url: row.siteUrl}]"/>
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3EnvironmentSortField.BUCKET" let-row>
                {{ row.bucket || "—" }}
                @if (environmentConsoleLinks(row).length) {
                  <div class="d-flex align-items-center gap-2 mt-2">
                    <app-vendor-brand-mark serviceId="aws" [sizePx]="18" [inline]="true"/>
                    <app-console-access-links [links]="environmentConsoleLinks(row)" [showEmpty]="false"/>
                  </div>
                }
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3EnvironmentSortField.REGION" let-row>
                {{ awsRegionLabel(row.region) }}
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3EnvironmentSortField.EXPECTED" let-row>
                {{ row.expectedLondonBucket }}
              </ng-template>
              <ng-template [appSortableTableCell]="AwsS3EnvironmentSortField.STATUS" let-row>
                <span class="text-nowrap" [class]="awsS3StatusBadgeClass(row.status)">{{ awsS3StatusLabel(row.status) }}</span>
              </ng-template>
              <ng-template [appSortableTableCell]="'actions'" let-row>
                @if (row.status === AwsS3MigrationStatus.NOT_MIGRATED || row.status === AwsS3MigrationStatus.NO_BUCKET) {
                  <a class="row-action-icon" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_MIGRATION"
                     [queryParams]="moveS3QueryParams(row.environment)"
                     tooltip="Move to Ramblers storage" container="body" aria-label="Move to Ramblers storage">
                    <fa-icon [icon]="faExchangeAlt"/>
                  </a>
                }
              </ng-template>
            </app-sortable-table>
          </div>
        </tab>
      </tabset>
    </app-page>
  `
})
export class EnvironmentAwsComponent implements OnInit, OnDestroy {
  private logger: Logger = inject(LoggerFactory).createLogger("EnvironmentAwsComponent", NgxLoggerLevel.ERROR);
  private environmentSetupService = inject(EnvironmentSetupService);
  private notifierService = inject(NotifierService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private subscriptions: Subscription[] = [];
  public notifyTarget: AlertTarget = {};

  protected readonly faSpinner = faSpinner;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faKey = faKey;
  protected readonly faArrowsRotate = faArrowsRotate;
  protected readonly faExchangeAlt = faExchangeAlt;
  protected readonly AdminPlatformPath = AdminPlatformPath;
  protected readonly StoredValue = StoredValue;
  protected readonly EnvironmentAwsTab = EnvironmentAwsTab;
  protected readonly AwsS3BucketSortField = AwsS3BucketSortField;
  protected readonly AwsS3EnvironmentSortField = AwsS3EnvironmentSortField;
  protected readonly AwsS3MigrationStatus = AwsS3MigrationStatus;
  protected readonly awsS3StatusLabel = awsS3StatusLabel;
  protected readonly awsS3StatusBadgeClass = awsS3StatusBadgeClass;
  protected readonly awsRegionLabel = awsRegionLabel;
  protected readonly environmentSetupGlobalQueryParams = {
    [StoredValue.TAB]: toKebabCase(EnvironmentSetupTab.SETTINGS),
    [StoredValue.SUB_TAB]: EnvironmentSettingsSubTab.GLOBAL
  };

  view: AwsS3InventoryView | null = null;
  loading = true;
  errorMessage: string | null = null;
  activeTab = EnvironmentAwsTab.PROVISIONING;
  bucketSortKey = AwsS3BucketSortField.STATUS;
  bucketSortDirection = ASCENDING;
  environmentSortKey = AwsS3EnvironmentSortField.STATUS;
  environmentSortDirection = ASCENDING;

  bucketColumns: SortableTableColumn<AwsS3BucketRow>[] = [
    {key: AwsS3BucketSortField.NAME, label: "Bucket", sortKey: AwsS3BucketSortField.NAME},
    {key: AwsS3BucketSortField.REGION, label: "Region", sortKey: AwsS3BucketSortField.REGION, cellClass: "text-nowrap", filterText: row => awsRegionLabel(row.region)},
    {key: AwsS3BucketSortField.KIND, label: "Use", sortKey: AwsS3BucketSortField.KIND, filterText: row => this.kindLabel(row.kind)},
    {key: AwsS3BucketSortField.ENVIRONMENTS, label: "Sites", sortKey: AwsS3BucketSortField.ENVIRONMENTS, filterValues: row => row.environments},
    {key: AwsS3BucketSortField.STATUS, label: "London move", sortKey: AwsS3BucketSortField.STATUS, filterText: row => awsS3StatusLabel(row.status)},
    {key: "actions", label: "", cellClass: "text-nowrap"}
  ];

  environmentColumns: SortableTableColumn<AwsS3EnvironmentRow>[] = [
    {key: AwsS3EnvironmentSortField.ENVIRONMENT, label: "Environment", sortKey: AwsS3EnvironmentSortField.ENVIRONMENT},
    {key: AwsS3EnvironmentSortField.BUCKET, label: "Current bucket", sortKey: AwsS3EnvironmentSortField.BUCKET},
    {key: AwsS3EnvironmentSortField.REGION, label: "Region", sortKey: AwsS3EnvironmentSortField.REGION, cellClass: "text-nowrap", filterText: row => awsRegionLabel(row.region)},
    {key: AwsS3EnvironmentSortField.EXPECTED, label: "London bucket", sortKey: AwsS3EnvironmentSortField.EXPECTED},
    {key: AwsS3EnvironmentSortField.STATUS, label: "London move", sortKey: AwsS3EnvironmentSortField.STATUS, filterText: row => awsS3StatusLabel(row.status)},
    {key: "actions", label: "", cellClass: "text-nowrap"}
  ];

  ngOnInit() {
    this.notifierService.createAlertInstance(this.notifyTarget);
    this.subscriptions.push(this.activatedRoute.queryParams.subscribe(params => {
      this.activeTab = params[StoredValue.TAB] === EnvironmentAwsTab.BUCKETS || params[StoredValue.TAB] === EnvironmentAwsTab.ENVIRONMENTS
        ? params[StoredValue.TAB]
        : EnvironmentAwsTab.PROVISIONING;
      this.bucketSortKey = params[StoredValue.AWS_BUCKET_SORT] || AwsS3BucketSortField.STATUS;
      this.bucketSortDirection = params[StoredValue.AWS_BUCKET_SORT_ORDER] === DESCENDING ? DESCENDING : ASCENDING;
      this.environmentSortKey = params[StoredValue.AWS_ENVIRONMENT_SORT] || AwsS3EnvironmentSortField.STATUS;
      this.environmentSortDirection = params[StoredValue.AWS_ENVIRONMENT_SORT_ORDER] === DESCENDING ? DESCENDING : ASCENDING;
    }));
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  trackBucket = (_index: number, row: AwsS3BucketRow) => row.name;
  trackEnvironment = (_index: number, row: AwsS3EnvironmentRow) => row.environment;

  selectTab(tab: EnvironmentAwsTab): void {
    this.activeTab = tab;
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {[StoredValue.TAB]: tab},
      queryParamsHandling: "merge"
    });
  }

  kindLabel(kind: AwsS3BucketKind): string {
    if (kind === AwsS3BucketKind.ARCHIVE) {
      return "Archive";
    } else if (kind === AwsS3BucketKind.SITE) {
      return "Site";
    } else {
      return "Unmapped";
    }
  }

  moveS3QueryParams(environment: string) {
    return {
      [StoredValue.ENVIRONMENT]: environment,
      [StoredValue.MIGRATION_MODE]: EnvironmentMigrationMode.S3_ONLY,
      [StoredValue.TAB]: kebabCase(EnvironmentMigrationTab.PLAN)
    };
  }

  consoleHomeLinks() {
    return resolveConsoleUrls(AWS_S3_CONSOLE_URLS, {
      accountId: this.view?.accountId || "",
      region: this.view?.region || "",
      bucket: ""
    }).filter(link => link.iconKey === ConsoleAccessUrlIconKey.CONSOLE);
  }

  bucketConsoleLinks(row: AwsS3BucketRow) {
    return resolveConsoleUrls(AWS_S3_CONSOLE_URLS, {
      accountId: this.view?.accountId || "",
      region: row.region || this.view?.region || "",
      bucket: row.name
    }).filter(link => link.iconKey === ConsoleAccessUrlIconKey.BUCKET);
  }

  environmentConsoleLinks(row: AwsS3EnvironmentRow) {
    if (!row.bucket) {
      return [];
    } else {
      return resolveConsoleUrls(AWS_S3_CONSOLE_URLS, {
        accountId: row.inRamblersAccount ? this.view?.accountId || "" : "",
        region: row.region || "",
        bucket: row.bucket
      }).filter(link => link.iconKey === ConsoleAccessUrlIconKey.BUCKET);
    }
  }

  async load() {
    this.loading = true;
    this.errorMessage = null;
    try {
      this.view = await this.environmentSetupService.awsS3Inventory();
    } catch (error) {
      this.errorMessage = error?.error?.error || error?.message || "Could not load AWS buckets";
      this.logger.error("load", error);
    } finally {
      this.loading = false;
    }
  }

  bucketSortChanged(state: SortableTableSortState) {
    this.bucketSortKey = (state.key as AwsS3BucketSortField) || AwsS3BucketSortField.STATUS;
    this.bucketSortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    this.updateQueryParams();
  }

  environmentSortChanged(state: SortableTableSortState) {
    this.environmentSortKey = (state.key as AwsS3EnvironmentSortField) || AwsS3EnvironmentSortField.STATUS;
    this.environmentSortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    this.updateQueryParams();
  }

  private updateQueryParams() {
    this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        [StoredValue.TAB]: this.activeTab,
        [StoredValue.AWS_BUCKET_SORT]: this.bucketSortKey,
        [StoredValue.AWS_BUCKET_SORT_ORDER]: this.bucketSortDirection,
        [StoredValue.AWS_ENVIRONMENT_SORT]: this.environmentSortKey,
        [StoredValue.AWS_ENVIRONMENT_SORT_ORDER]: this.environmentSortDirection
      },
      queryParamsHandling: "merge"
    });
  }
}
