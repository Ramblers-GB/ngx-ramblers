import { enumValues } from "../../../functions/enums";
import { UiActionsService } from "../../../services/ui-actions.service";
import { CommonModule } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import {
  faArrowRight,
  faArrowLeft,
  faCircleCheck,
  faCircleExclamation,
  faDatabase,
  faList,
  faRotate,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import { isString, kebabCase } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { TabDirective, TabsetComponent } from "ngx-bootstrap/tabs";
import { TooltipModule } from "ngx-bootstrap/tooltip";
import { firstValueFrom } from "rxjs";
import { EnvironmentInfo } from "../../../models/backup-session.model";
import {
  EnvironmentMigrationAudit,
  EnvironmentMigrationMode,
  EnvironmentMigrationPhase,
  EnvironmentMigrationRequest,
  EnvironmentMigrationStatus,
  EnvironmentMigrationStepKey,
  EnvironmentMigrationStepState,
  EnvironmentMigrationTab,
  migrationAllowsCredentialRotation,
  migrationIncludesMongo,
  MOVE_PROGRESS_CHECK_LIMIT,
  MOVE_PROGRESS_CHECK_MS,
  repeatDatabaseMoveUnderway,
  resumableMove,
  migrationIncludesS3,
  migrationModeLabel
} from "../../../models/environment-migration.model";
import { SortableTableAlignment, SortableTableColumn } from "../../../modules/common/sortable-table/sortable-table.model";
import { SortableTableCellDirective } from "../../../modules/common/sortable-table/sortable-table-cell.directive";
import { SortableTableComponent } from "../../../modules/common/sortable-table/sortable-table.component";
import { EnvironmentSelectComponent } from "../../../modules/common/selectors/environment-select";
import { MongoClusterSelectComponent } from "../../../modules/common/selectors/mongo-cluster-select";
import { generateDestinationBucketName, MongoClusterInfo } from "../../../models/environment-setup.model";
import { AtlasClusterView, clusterAcceptsMigratedSite, clusterDisplayName } from "../../../models/atlas-cluster.model";
import { EnvironmentSetupService } from "../../../services/environment-setup/environment-setup.service";
import { VendorBrandMarkComponent } from "../../../modules/common/vendor-brand-mark/vendor-brand-mark.component";
import { PageComponent } from "../../../page/page.component";
import { BackupAndRestoreService } from "../../../services/backup-and-restore.service";
import { EnvironmentConfigService } from "../../../services/environment-config.service";
import { EnvironmentMigrationService } from "../../../services/environment-migration.service";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { StoredValue } from "../../../models/ui-actions.model";
import { AdminPlatformPath } from "../../../models/admin-route-paths.model";
import { DisplayDateAbbreviatedTimePipe } from "../../../pipes/display-date-abbreviated-time.pipe";
import { DESCENDING } from "../../../models/table-filtering.model";
import { AWS_DEFAULTS, EnvironmentsConfig } from "../../../models/environment-config.model";
import { AlertPanelVariant } from "../../../models/alert-panel.model";
import { AlertPanelComponent } from "../../../modules/common/alert-panel/alert-panel";

@Component({
  selector: "app-environment-migration",
  imports: [
    CommonModule,
    DisplayDateAbbreviatedTimePipe,
    EnvironmentSelectComponent,
    FontAwesomeModule,
    MongoClusterSelectComponent,
    FormsModule,
    PageComponent,
    SortableTableCellDirective,
    SortableTableComponent,
    TabDirective,
    TabsetComponent,
    TooltipModule,
    VendorBrandMarkComponent,
    AlertPanelComponent
  ],
  styles: [`
    .status-pill
      display: inline-block
      padding: 0.25rem 0.5rem
      border-radius: 0.25rem
      font-weight: 600
      white-space: nowrap
      background: var(--ramblers-colour-granite, #f1f3f5)

    .status-pill.completed
      background: rgba(25, 135, 84, 0.12)
      color: #146c43

    .status-pill.failed,
    .status-pill.missing-manifest
      background: rgba(220, 53, 69, 0.12)
      color: #b02a37

    .status-pill.in-progress,
    .status-pill.pending
      background: rgba(255, 193, 7, 0.18)
      color: #664d03

    .table-action-button
      white-space: nowrap
      min-width: 5rem
      color: var(--bs-body-color)
      border-color: var(--bs-secondary-border-subtle)
      background-color: var(--bs-light)

    .table-action-button:hover,
    .table-action-button:focus
      color: var(--bs-body-color)
      border-color: var(--ramblers-colour-sunrise, #f9b104)
      background-color: var(--ramblers-colour-sunrise, #f9b104)

    .result-panel
      border: 1px solid rgba(155, 200, 171, 0.35)
      border-radius: 8px
      padding: 1rem

  `],
  template: `
    <app-page autoTitle pageTitle="Environment Migration">
      <div class="thumbnail-heading-frame thumbnail-heading-frame-compact mt-3">
        <div class="thumbnail-heading">Environment</div>
        <div class="row">
          <div class="col-12 col-lg-6">
            <app-environment-select
              [items]="selectableEnvironments()"
              [disabled]="busy"
              [(selectedName)]="request.environment"
              (selectedNameChange)="onEnvironmentChange()"
              placeholder="All environments"></app-environment-select>
          </div>
          @if (returnUrl) {
            <div class="col-12 col-lg-6 d-flex justify-content-lg-end align-items-start mt-2 mt-lg-0">
              <button type="button" class="btn btn-quiet text-nowrap" (click)="goBack()"><fa-icon [icon]="faArrowLeft" class="me-1"/>Back</button>
            </div>
          }
        </div>
      </div>
      <tabset class="custom-tabset">
        <tab [active]="tabActive(EnvironmentMigrationTab.PLAN)"
             (selectTab)="selectTab(EnvironmentMigrationTab.PLAN)"
             [heading]="EnvironmentMigrationTab.PLAN">
          <div class="img-thumbnail thumbnail-admin-edit mt-3">
            <div class="thumbnail-heading-frame">
              <div class="thumbnail-heading">{{ moveHeading() }}</div>
              @if (!request.environment) {
                <p class="mb-0">Choose an environment above.</p>
              } @else {
                <dl class="row mb-3">
                  @if (includeMongo()) {
                    <dt class="col-sm-3">Database</dt>
                    <dd class="col-sm-9">{{ databaseFrom() }} <fa-icon [icon]="faArrowRight" class="mx-2"/> {{ databaseTo() }}</dd>
                  }
                  @if (includeS3()) {
                    <dt class="col-sm-3">Photos and files</dt>
                    <dd class="col-sm-9">{{ filesFrom() }} <fa-icon [icon]="faArrowRight" class="mx-2"/> {{ filesTo() }}</dd>
                  }
                </dl>
                @if (nextStepState() === EnvironmentMigrationStepState.DONE && !moving) {
                  <div class="alert alert-success d-flex align-items-start mb-0" role="status">
                    <fa-icon [icon]="faCircleCheck" class="me-2 mt-1"/>
                    <div><strong>Migration completed</strong><div>{{ moveCompleted || completedMessage() }}</div></div>
                  </div>
                } @else if (nextStepState() === EnvironmentMigrationStepState.RUNNING || moving) {
                  <div class="alert alert-warning d-flex align-items-start mb-0" role="status">
                    <fa-icon [icon]="faSpinner" animation="spin" class="me-2 mt-1"/>
                    <div>
                      <strong>Moving {{ request.environment }}</strong>
                      <div>{{ runningLabel() }}</div>
                      @if (selectedMigration?.heartbeatAt) {
                        <div class="small">Last update {{ selectedMigration.heartbeatAt | displayDateAbbreviatedTime }}.</div>
                      }
                    </div>
                  </div>
                }
                @if (!moving && nextStepState() !== EnvironmentMigrationStepState.RUNNING) {
                  @if (showDatabaseTarget()) {
                    <div class="row mb-2 mt-3">
                      <div class="col-lg-6">
                        <label class="form-label" for="move-target">Where do you want to move to?</label>
                        <app-mongo-cluster-select id="move-target" [clusters]="targetClusterOptions()" [selected]="selectedTargetCluster()"
                                                  [disabled]="busy"
                                                  [placeholder]="targetClusters.length ? 'Choose a server with room for this site' : 'Loading servers…'"
                                                  (selectedChange)="targetClusterChanged($event)"/>
                        @if (moveHint()) {
                          <div class="form-text">{{ moveHint() }}</div>
                        }
                      </div>
                    </div>
                  }
                  @if (nextStepState() !== EnvironmentMigrationStepState.DONE) {
                    <button type="button" class="btn btn-primary" [disabled]="!moveReady()" (click)="moveNow()">
                      <fa-icon [icon]="faDatabase" class="me-1"/>{{ moveLabel() }}
                    </button>
                  }
                }
              }
              @if (moveCompleted && nextStepState() !== EnvironmentMigrationStepState.DONE) {
                <div class="alert alert-success d-flex align-items-start mt-3 mb-0" role="status">
                  <fa-icon [icon]="faCircleCheck" class="me-2 mt-1"/>
                  <div><strong>Migration completed</strong><div>{{ moveCompleted }}</div></div>
                </div>
              }
              @if (error) {
                <div class="alert alert-danger d-flex align-items-start mt-3 mb-0" role="alert">
                  <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
                  <div>
                    <strong>Something went wrong</strong>
                    <div>{{ error }}</div>
                  </div>
                </div>
              }
            </div>
          </div>
        </tab>

        <tab [active]="tabActive(EnvironmentMigrationTab.RESULT)"
             (selectTab)="selectTab(EnvironmentMigrationTab.RESULT)"
             [heading]="EnvironmentMigrationTab.RESULT">
          <div class="result-panel mt-3">
            @if (selectedMigration) {
              <p><span class="status-pill" [ngClass]="statusClass(selectedMigration.status)">{{ selectedMigration.status }}</span> {{ selectedMigration.phase }}</p>
              @if (selectedMigration.status === EnvironmentMigrationStatus.ORPHANED) {
                <div class="alert alert-warning d-flex align-items-start" role="alert">
                  <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
                  <div>
                    <strong>Interrupted</strong>
                    <div>This migration was interrupted by a server restart. Inspect the target database and restart with fresh target credentials.</div>
                  </div>
                </div>
              }
              <dl class="row">
                <dt class="col-sm-4">Environment</dt>
                <dd class="col-sm-8">{{ selectedMigration.environment }}</dd>
                <dt class="col-sm-4">Type</dt>
                <dd class="col-sm-8">
                  <span class="d-inline-flex align-items-center gap-2" [tooltip]="migrationModeLabel(selectedMigration.mode)" container="body">
                    @if (migrationIncludesMongo(selectedMigration.mode)) {
                      <app-vendor-brand-mark serviceId="mongodbAtlas" [sizePx]="22"/>
                    }
                    @if (migrationIncludesS3(selectedMigration.mode)) {
                      <app-vendor-brand-mark serviceId="aws" [sizePx]="22"/>
                    }
                  </span>
                </dd>
                <dt class="col-sm-4">Migration</dt>
                <dd class="col-sm-8">{{ selectedMigration.migrationId }}</dd>
                @if (migrationIncludesMongo(selectedMigration.mode) && selectedMigration.sourceMongo?.uriSummary) {
                  <dt class="col-sm-4">Source Mongo</dt>
                  <dd class="col-sm-8">{{ selectedMigration.sourceMongo.uriSummary }}</dd>
                }
                @if (migrationIncludesMongo(selectedMigration.mode) && selectedMigration.targetMongo?.uriSummary) {
                  <dt class="col-sm-4">Target Mongo</dt>
                  <dd class="col-sm-8">{{ selectedMigration.targetMongo.uriSummary }}</dd>
                }
                @if (selectedMigration.targetAws?.bucket) {
                  <dt class="col-sm-4">Destination S3</dt>
                  <dd class="col-sm-8">{{ selectedMigration.targetAws.bucket }} ({{ selectedMigration.targetAws.region }})</dd>
                }
                @if (migrationIncludesMongo(selectedMigration.mode) || selectedMigration.backupName || selectedMigration.backupPath) {
                  <dt class="col-sm-4">Backup</dt>
                  <dd class="col-sm-8">{{ selectedMigration.backupName || selectedMigration.backupPath || selectedMigration.rollbackInfo?.backupUsed || "not created" }}</dd>
                }
                <dt class="col-sm-4">Heartbeat</dt>
                <dd class="col-sm-8">{{ selectedMigration.heartbeatAt ? (selectedMigration.heartbeatAt | displayDateAbbreviatedTime) : "not started" }}</dd>
              </dl>
              @if (selectedMigration.error || error) {
                <div class="alert alert-danger d-flex align-items-start" role="alert">
                  <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
                  <div>
                    <strong>Migration failed</strong>
                    <div>{{ selectedMigration.error || error }}</div>
                  </div>
                </div>
              }
              @if (migrationIncludesMongo(selectedMigration.mode) && selectedMigration.verification) {
                <h3 class="h6">Verification</h3>
                <ul class="list-unstyled">
                  <li>Group: {{ selectedMigration.verification.systemGroupIdentity?.shortName || selectedMigration.verification.systemGroupIdentity?.groupCode }}</li>
                  <li>Collections: {{ selectedMigration.verification.collections.length }}</li>
                  <li>Total documents: {{ selectedMigration.verification.totalDocumentCount }}</li>
                  @if (selectedMigration.verification.stagingEnvironments) {
                    <li>Staging environments: {{ selectedMigration.verification.stagingEnvironments.count }}</li>
                    @if (selectedMigration.verification.stagingEnvironments.missing.length > 0) {
                      <li>
                        <app-alert-panel class="mt-2 mb-0" compact title="Missing staging environments"
                                         [icon]="faCircleExclamation" [variant]="AlertPanelVariant.DANGER">
                          {{ selectedMigration.verification.stagingEnvironments.missing.join(", ") }}
                        </app-alert-panel>
                      </li>
                    }
                  }
                </ul>
                <app-sortable-table
                  [columns]="collectionCountColumns"
                  [rows]="selectedMigration.verification.keyCollectionCounts"
                  [trackBy]="trackCollectionCount"
                  emptyMessage="No collection counts returned">
                </app-sortable-table>
              }
              @if (selectedMigration.s3Backups?.length || selectedMigration.s3Restores?.length) {
                <h3 class="h6 mt-3">S3 Results</h3>
                <app-sortable-table
                  [columns]="s3Columns"
                  [rows]="s3Rows(selectedMigration)"
                  [trackBy]="trackS3Summary"
                  emptyMessage="No S3 results returned">
                </app-sortable-table>
              }
            } @else {
              <p class="text-muted mb-0">{{ latestResultEmptyMessage() }}</p>
            }
          </div>
        </tab>

        <tab [active]="tabActive(EnvironmentMigrationTab.HISTORY)"
             (selectTab)="selectTab(EnvironmentMigrationTab.HISTORY)"
             [heading]="EnvironmentMigrationTab.HISTORY">
          <div class="d-flex justify-content-end mt-3 mb-2">
            <button type="button" class="btn btn-quiet" (click)="loadHistory()" [disabled]="busy">
              <fa-icon [icon]="faRotate" class="me-1"/>Refresh
            </button>
          </div>
          <app-sortable-table
            [columns]="historyColumns"
            [rows]="history"
            [trackBy]="trackMigration"
            defaultSortKey="startTime"
            [defaultSortDirection]="DESCENDING"
            maxHeight="70vh"
            [emptyMessage]="historyEmptyMessage()">
            <ng-template appSortableTableCell="started" let-migration>
              {{ migration.startTime | displayDateAbbreviatedTime }}
            </ng-template>
            <ng-template appSortableTableCell="type" let-migration>
              <span class="d-inline-flex align-items-center justify-content-center gap-1" [tooltip]="migrationModeLabel(migration.mode)" container="body">
                @if (migrationIncludesMongo(migration.mode)) {
                  <app-vendor-brand-mark serviceId="mongodbAtlas" [sizePx]="22"/>
                }
                @if (migrationIncludesS3(migration.mode)) {
                  <app-vendor-brand-mark serviceId="aws" [sizePx]="22"/>
                }
              </span>
            </ng-template>
            <ng-template appSortableTableCell="status" let-migration>
              <span class="status-pill" [ngClass]="statusClass(migration.status)">{{ migration.status }}</span>
            </ng-template>
            <ng-template appSortableTableCell="actions" let-migration>
              <button class="btn btn-sm table-action-button" type="button" (click)="selectMigration(migration)">
                <fa-icon [icon]="faList" class="me-1"/>Select
              </button>
            </ng-template>
          </app-sortable-table>
        </tab>
      </tabset>
    </app-page>
  `
})

export class EnvironmentMigrationComponent implements OnInit {
  private logger: Logger = inject(LoggerFactory).createLogger(EnvironmentMigrationComponent, NgxLoggerLevel.ERROR);
  private backupService = inject(BackupAndRestoreService);
  private environmentConfigService = inject(EnvironmentConfigService);
  private migrationService = inject(EnvironmentMigrationService);
  private environmentSetupService = inject(EnvironmentSetupService);
  private activatedRoute = inject(ActivatedRoute);
  private router = inject(Router);
  private tab: EnvironmentMigrationTab | string = EnvironmentMigrationTab.PLAN;

  private readonly uiActions = inject(UiActionsService);
  protected readonly EnvironmentMigrationStatus = EnvironmentMigrationStatus;
  protected readonly EnvironmentMigrationTab = EnvironmentMigrationTab;
  protected readonly EnvironmentMigrationStepKey = EnvironmentMigrationStepKey;
  protected readonly EnvironmentMigrationStepState = EnvironmentMigrationStepState;
  protected readonly migrationIncludesMongo = migrationIncludesMongo;
  protected readonly migrationIncludesS3 = migrationIncludesS3;
  protected readonly migrationModeLabel = migrationModeLabel;
  protected readonly DESCENDING = DESCENDING;
  protected readonly AlertPanelVariant = AlertPanelVariant;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faArrowRight = faArrowRight;
  protected readonly faCircleCheck = faCircleCheck;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faList = faList;
  protected readonly faRotate = faRotate;
  protected readonly faSpinner = faSpinner;
  protected readonly faDatabase = faDatabase;

  environments: EnvironmentInfo[] = [];
  environmentsWithMongo: EnvironmentInfo[] = [];
  history: EnvironmentMigrationAudit[] = [];
  selectedMigration: EnvironmentMigrationAudit | null = null;
  environmentsConfig: EnvironmentsConfig | null = null;
  targetClusters: MongoClusterInfo[] = [];
  private targetClusterOptionsCache: MongoClusterInfo[] = [];
  private targetClusterOptionsSource: MongoClusterInfo[] | null = null;
  private targetClusterOptionsKey = "";
  error = "";
  busy = false;
  moving = false;
  serverChosen = false;
  moveCompleted = "";
  returnUrl: string | null = null;
  busyAction = "";
  private pollingMigrationId: string | null = null;

  historyColumns: SortableTableColumn<EnvironmentMigrationAudit>[] = [
    { key: "started", label: "Started", sortKey: "startTime" },
    { key: "environment", label: "Environment", sortKey: "environment", cellGetter: row => row.environment },
    { key: "type", label: "Type", sortKey: "mode", align: SortableTableAlignment.CENTER, cellGetter: row => migrationModeLabel(row.mode) },
    { key: "status", label: "Status", sortKey: "status" },
    { key: "source", label: "Source", cellGetter: row => row.sourceMongo?.uriSummary || row.sourceAws?.bucket || "" },
    { key: "target", label: "Target", cellGetter: row => row.targetMongo?.uriSummary || row.targetAws?.bucket || "" },
    { key: "actions", label: "", align: SortableTableAlignment.RIGHT }
  ];

  collectionCountColumns: SortableTableColumn[] = [
    { key: "collection", label: "Collection", sortKey: "collection", cellGetter: row => row.collection },
    { key: "count", label: "Count", sortKey: "count", align: SortableTableAlignment.RIGHT, cellGetter: row => row.count }
  ];

  s3Columns: SortableTableColumn[] = [
    { key: "site", label: "Site", sortKey: "site", cellGetter: row => row.site },
    { key: "status", label: "Status", sortKey: "status", cellGetter: row => row.status },
    { key: "copiedObjects", label: "Objects", sortKey: "copiedObjects", align: SortableTableAlignment.RIGHT, cellGetter: row => row.copiedObjects },
    { key: "skippedObjects", label: "Skipped", sortKey: "skippedObjects", align: SortableTableAlignment.RIGHT, cellGetter: row => row.skippedObjects }
  ];

  request: EnvironmentMigrationRequest = {
    environment: "",
    mode: EnvironmentMigrationMode.MONGO_AND_S3,
    dryRun: true,
    targetMongo: {
      cluster: "",
      db: "",
      username: "",
      password: ""
    },
    confirmEnvironment: "",
    rotateS3Credentials: true,
    targetAws: this.emptyTargetAws()
  };

  async ngOnInit(): Promise<void> {
    this.rememberHowWeArrived();
    const initialEnvironment = this.activatedRoute.snapshot.queryParams[StoredValue.ENVIRONMENT];
    if (isString(initialEnvironment) && initialEnvironment) {
      this.request.environment = initialEnvironment;
    }
    this.activatedRoute.queryParams.subscribe(params => {
      this.tab = params[StoredValue.TAB] || kebabCase(EnvironmentMigrationTab.PLAN);
      const environment = params[StoredValue.ENVIRONMENT];
      if (isString(environment) && environment !== this.request.environment) {
        this.request.environment = environment;
        void this.onEnvironmentChange();
      } else if (!environment && this.request.environment) {
        this.request.environment = "";
        void this.onEnvironmentChange();
      }
    });
    void this.loadTargetClusters();
    await Promise.all([this.loadEnvironments(), this.loadHistory(), this.loadEnvironmentConfig()]);
    this.selectRemainingMigration();
    void this.prepareRamblersStorage();
  }

  async loadEnvironments(): Promise<void> {
    try {
      this.environments = await firstValueFrom(this.backupService.listEnvironments());
      this.environmentsWithMongo = this.environments.filter(environment => environment.hasMongoConfig);
    } catch (error: any) {
      this.logger.error("Failed to load environments:", error);
      this.error = this.extractErrorMessage(error, "Failed to load environments");
    }
  }

  async loadHistory(): Promise<void> {
    try {
      this.history = await firstValueFrom(this.migrationService.history(50, this.request.environment || ""));
    } catch (error: any) {
      this.logger.error("Failed to load migration history:", error);
      this.error = this.extractErrorMessage(error, "Failed to load migration history");
    }
  }

  async loadTargetClusters(): Promise<void> {
    const cached = this.environmentSetupService.cachedAtlasClusters();
    if (cached) {
      this.targetClusters = this.targetClustersFrom(cached);
    }
    try {
      this.targetClusters = this.targetClustersFrom(await this.environmentSetupService.atlasClusters());
    } catch (error) {
      this.logger.error("Failed to load Atlas clusters:", error);
      this.targetClusters = cached ? this.targetClusters : [];
    }
  }

  private targetClustersFrom(view: AtlasClusterView): MongoClusterInfo[] {
    return view.clusters
      .filter(cluster => clusterAcceptsMigratedSite(cluster, view.projectId))
      .map(cluster => ({cluster: cluster.host, username: "", password: "", databases: [], environments: cluster.environmentNames ? cluster.environmentNames.split(", ") : []}));
  }

  targetClusterOptions(): MongoClusterInfo[] {
    const sourceCluster = this.sourceCluster();
    const current = this.request.targetMongo.cluster || "";
    const key = [sourceCluster, current].join("|");
    if (this.targetClusterOptionsSource !== this.targetClusters || this.targetClusterOptionsKey !== key) {
      const options = this.targetClusters.filter(cluster => cluster.cluster !== sourceCluster);
      this.targetClusterOptionsCache = current && !options.some(option => option.cluster === current)
        ? [...options, {cluster: current, username: "", password: "", databases: [], environments: []}]
        : options;
      this.targetClusterOptionsSource = this.targetClusters;
      this.targetClusterOptionsKey = key;
    }
    return this.targetClusterOptionsCache;
  }

  selectedTargetCluster(): MongoClusterInfo | null {
    return this.targetClusterOptions().find(option => option.cluster === this.request.targetMongo.cluster) || null;
  }

  targetClusterChanged(cluster: MongoClusterInfo | null): void {
    this.request.targetMongo = {...this.request.targetMongo, cluster: cluster?.cluster || "", username: "", password: ""};
    this.serverChosen = !!cluster?.cluster;
    this.selectedMigration = null;
    this.selectRemainingMigration();
  }

  async loadEnvironmentConfig(): Promise<void> {
    try {
      this.environmentsConfig = await firstValueFrom(this.environmentConfigService.events());
      if (!this.request.targetMongo.cluster) {
        this.request.targetMongo.cluster = this.environmentsConfig?.atlas?.defaultCluster || "";
      }
    } catch (error: any) {
      this.logger.error("Failed to load environment config:", error);
      this.environmentsConfig = null;
    }
  }

  selectTab(tab: EnvironmentMigrationTab) {
    this.router.navigate([], {
      queryParams: {
        [StoredValue.TAB]: kebabCase(tab),
        [StoredValue.ENVIRONMENT]: this.request.environment || null
      },
      queryParamsHandling: "merge"
    });
  }

  latestResultEmptyMessage(): string {
    if (this.request.environment) {
      return `No migration result yet for ${this.request.environment}. Run the check on Plan & Restore, or pick a row on History.`;
    } else {
      return "Select an environment to see its latest result, or pick a row on History.";
    }
  }

  historyEmptyMessage(): string {
    if (this.request.environment) {
      return `No migration records for ${this.request.environment}`;
    } else {
      return "No migration records yet";
    }
  }

  tabActive(tab: EnvironmentMigrationTab): boolean {
    return kebabCase(this.tab) === kebabCase(tab);
  }

  async onEnvironmentChange(): Promise<void> {
    this.pollingMigrationId = null;
    this.serverChosen = false;
    this.moveCompleted = "";
    const environment = this.environments.find(candidate => candidate.name === this.request.environment);
    this.request.targetMongo = {...this.request.targetMongo, db: environment?.database || "", username: "", password: ""};
    this.request.targetAws = this.emptyTargetAws();
    this.request.confirmEnvironment = "";
    await this.router.navigate([], {
      queryParams: {
        [StoredValue.TAB]: kebabCase(this.tab),
        [StoredValue.ENVIRONMENT]: this.request.environment || null
      },
      queryParamsHandling: "merge"
    });
    await this.loadHistory();
    this.selectRemainingMigration();
    void this.prepareRamblersStorage();
  }

  async useRamblersStorage(): Promise<void> {
    this.busy = true;
    this.busyAction = "ramblers-storage";
    this.error = "";
    try {
      this.request.targetAws = await firstValueFrom(this.migrationService.platformAwsTarget(this.request.environment));
    } catch (error) {
      this.logger.error("Failed to load Ramblers storage details:", error);
      this.error = this.extractErrorMessage(error, "Could not load the Ramblers storage details for this site");
    } finally {
      this.busy = false;
      this.busyAction = "";
    }
  }

  async provisionMongoTarget(): Promise<void> {
    this.busy = true;
    this.busyAction = "provision";
    this.error = "";
    try {
      this.request.targetMongo = await firstValueFrom(this.migrationService.provisionMongoTarget({environment: this.request.environment, cluster: this.request.targetMongo.cluster}));
      this.selectedMigration = null;
    } catch (error) {
      this.logger.error("Failed to provision migration database user:", error);
      this.error = this.extractErrorMessage(error, "Could not create the target database user");
    } finally {
      this.busy = false;
      this.busyAction = "";
    }
  }

  stepKeys(): EnvironmentMigrationStepKey[] {
    return [
      ...(this.includeMongo() ? [EnvironmentMigrationStepKey.PREPARE] : []),
      EnvironmentMigrationStepKey.CHECK,
      EnvironmentMigrationStepKey.COPY,
      EnvironmentMigrationStepKey.SWITCH
    ];
  }

  nextStep(): EnvironmentMigrationStepKey {
    const keys = this.stepKeys();
    return keys.find(key => this.stepState(key) !== EnvironmentMigrationStepState.DONE) || keys[keys.length - 1];
  }

  nextStepState(): EnvironmentMigrationStepState {
    return this.stepState(this.nextStep());
  }

  runningLabel(): string {
    const labels: Record<EnvironmentMigrationStepKey, string> = {
      [EnvironmentMigrationStepKey.PREPARE]: "Creating database login…",
      [EnvironmentMigrationStepKey.CHECK]: "Checking…",
      [EnvironmentMigrationStepKey.COPY]: this.selectedMigration ? this.migrationStageLabel(this.selectedMigration) : "Copying…",
      [EnvironmentMigrationStepKey.SWITCH]: "Switching the site over…"
    };
    return this.busyAction === "ramblers-storage" ? "Loading Ramblers storage details…" : labels[this.nextStep()];
  }
  stepState(key: EnvironmentMigrationStepKey): EnvironmentMigrationStepState {
    const migration = this.currentMigration();
    const status = migration?.status;
    const stopped = status === EnvironmentMigrationStatus.FAILED || status === EnvironmentMigrationStatus.ORPHANED;
    switch (key) {
      case EnvironmentMigrationStepKey.PREPARE:
        if (this.busyAction === "provision") {
          return EnvironmentMigrationStepState.RUNNING;
        } else {
          return this.databaseReady() || this.copied() || this.copying() ? EnvironmentMigrationStepState.DONE : EnvironmentMigrationStepState.TODO;
        }
      case EnvironmentMigrationStepKey.CHECK:
        if (this.busyAction === "plan") {
          return EnvironmentMigrationStepState.RUNNING;
        } else if (migration?.dryRun && stopped) {
          return EnvironmentMigrationStepState.FAILED;
        } else {
          return migration ? EnvironmentMigrationStepState.DONE : EnvironmentMigrationStepState.TODO;
        }
      case EnvironmentMigrationStepKey.COPY:
        if (this.busyAction === "execute" || this.copying()) {
          return EnvironmentMigrationStepState.RUNNING;
        } else if (this.copied()) {
          return EnvironmentMigrationStepState.DONE;
        } else if (migration && !migration.dryRun && stopped) {
          return EnvironmentMigrationStepState.FAILED;
        } else {
          return EnvironmentMigrationStepState.TODO;
        }
      case EnvironmentMigrationStepKey.SWITCH:
        if (this.busyAction === "rotate") {
          return EnvironmentMigrationStepState.RUNNING;
        } else if (this.siteMoved()) {
          return EnvironmentMigrationStepState.DONE;
        } else if (status === EnvironmentMigrationStatus.FAILED && migration?.phase === EnvironmentMigrationPhase.ROTATE_CREDENTIALS) {
          return EnvironmentMigrationStepState.FAILED;
        } else {
          return EnvironmentMigrationStepState.TODO;
        }
    }
  }

  sourceCluster(): string {
    return this.environmentConfig()?.mongo?.cluster || "";
  }

  sourceBucket(): string {
    return this.environmentConfig()?.aws?.bucket || "";
  }

  targetBucket(): string {
    return this.request.targetAws.bucket || generateDestinationBucketName(this.request.environment);
  }

  databaseFrom(): string {
    return clusterDisplayName(this.siteMoved() ? this.currentMigration()?.sourceMongo?.cluster : this.sourceCluster()) || "current server";
  }

  databaseTo(): string {
    return clusterDisplayName(this.siteMoved() ? this.currentMigration()?.targetMongo?.cluster : this.request.targetMongo.cluster) || "no default server configured";
  }

  filesFrom(): string {
    return (this.siteMoved() ? this.currentMigration()?.sourceAws?.bucket : this.sourceBucket()) || "current bucket";
  }

  filesTo(): string {
    return (this.siteMoved() ? this.currentMigration()?.targetAws?.bucket : this.targetBucket()) || this.targetBucket();
  }

  databaseReady(): boolean {
    return !!(this.request.targetMongo.cluster && this.request.targetMongo.db && this.request.targetMongo.username && this.request.targetMongo.password);
  }

  filesReady(): boolean {
    return !this.includeS3() || !!(this.request.targetAws.bucket && this.request.targetAws.region && this.request.targetAws.accessKeyId && this.request.targetAws.secretAccessKey);
  }

  includeMongo(): boolean {
    return migrationIncludesMongo(this.request.mode);
  }

  includeS3(): boolean {
    return migrationIncludesS3(this.request.mode);
  }

  selectableEnvironments(): EnvironmentInfo[] {
    if (this.includeMongo()) {
      return this.environmentsWithMongo;
    } else {
      return this.environments.filter(environment => !!this.environmentsConfig?.environments?.find(config => config.environment === environment.name)?.aws?.bucket);
    }
  }

  async moveNow(): Promise<void> {
    this.moving = true;
    this.error = "";
    this.moveCompleted = "";
    this.request.confirmEnvironment = this.request.environment;
    try {
      const resumable = resumableMove(this.historyForEnvironment(), this.request.mode, this.request.targetMongo.cluster);
      if (resumable) {
        this.selectedMigration = resumable;
      } else {
        await this.prepareTargets();
        await this.plan();
        this.stopIfFailed();
        await this.execute(false);
        this.stopIfFailed();
      }
      await this.waitForCopyToSettle();
      if (!migrationAllowsCredentialRotation(this.currentMigration())) {
        throw new Error(this.currentMigration()?.error || "The copy did not finish, so the site has not been switched over. The Latest Result tab shows how far it got.");
      }
      await this.rotate();
      this.stopIfFailed();
      this.moveCompleted = this.completedMessage();
      this.serverChosen = false;
      this.selectRemainingMigration();
    } catch (error) {
      this.logger.error("moveNow failed:", error);
      this.error = this.extractErrorMessage(error, "The move did not finish");
    } finally {
      this.request.confirmEnvironment = "";
      this.moving = false;
    }
  }

  moveHeading(): string {
    if (!this.includeMongo() && this.includeS3()) {
      return "Move photos and files to Ramblers storage";
    } else if (this.includeMongo() && this.databaseMovedBefore()) {
      return "Move to another database server";
    } else {
      return "Move to Ramblers hosting";
    }
  }

  goBack(): void {
    if (this.returnUrl) {
      void this.router.navigateByUrl(this.returnUrl);
    }
  }

  private rememberHowWeArrived(): void {
    const previous = this.router.lastSuccessfulNavigation()?.previousNavigation?.finalUrl;
    const previousUrl = previous ? this.router.serializeUrl(previous) : null;
    this.returnUrl = previousUrl && !previousUrl.startsWith(`/${AdminPlatformPath.ENVIRONMENT_MANAGEMENT_MIGRATION}`) ? previousUrl : null;
  }

  moveReady(): boolean {
    if (!this.request.environment || this.busy || this.moving) {
      return false;
    } else if (this.includeMongo()) {
      return !!this.request.targetMongo.cluster;
    } else {
      return this.includeS3() && this.nextStepState() !== EnvironmentMigrationStepState.DONE;
    }
  }

  moveLabel(): string {
    if (this.includeMongo() && this.includeS3()) {
      return "Move database, photos and files";
    } else if (this.includeMongo()) {
      return "Move database";
    } else {
      return "Move photos and files";
    }
  }

  showDatabaseTarget(): boolean {
    return this.includeMongo() || (!this.requestedMigrationMode() && this.databaseMovedBefore());
  }

  private requestedMigrationMode(): EnvironmentMigrationMode | null {
    return this.uiActions.queryValueForAlias(this.activatedRoute.snapshot.queryParams[StoredValue.MIGRATION_MODE], enumValues(EnvironmentMigrationMode)) as EnvironmentMigrationMode | null;
  }

  moveHint(): string {
    if (this.showDatabaseTarget() && this.databaseMovedBefore() && !this.serverChosen && this.includeS3()) {
      return "Choose a server to move the database. With no server chosen, Move moves the photos and files only.";
    } else if (this.includeMongo() && !this.includeS3()) {
      return "Photos and files stay where they are.";
    } else {
      return "";
    }
  }

  private completedMessage(): string {
    const moved = [
      this.includeMongo() ? `the database is now on ${clusterDisplayName(this.request.targetMongo.cluster)}` : "",
      this.includeS3() ? `photos and files are now in ${this.request.targetAws.bucket}` : ""
    ].filter(part => !!part).join(" and ");
    if (!this.includeMongo()) {
      return `Moved: ${moved}. The site has been restarted to use it.`;
    } else if (this.currentMigration()?.siteDatabaseConfirmed) {
      return `Moved: ${moved}. The site has restarted and confirms it is connected to the new database.`;
    } else {
      return `Moved: ${moved}. The site has been restarted, but did not confirm which database it is connected to, so its old database login has been kept. Check the site on the MongoDB Atlas page, then delete the old login there.`;
    }
  }

  private databaseMovedBefore(): boolean {
    return this.historyForEnvironment().some(migration => migration.status === EnvironmentMigrationStatus.ROTATED && migrationIncludesMongo(migration.mode));
  }

  private historyForEnvironment(): EnvironmentMigrationAudit[] {
    return this.history.filter(migration => migration.environment === this.request.environment);
  }

  private async prepareTargets(): Promise<void> {
    if (this.includeMongo()) {
      await this.provisionMongoTarget();
      this.stopIfFailed();
    }
    if (this.includeS3() && !this.filesReady()) {
      await this.useRamblersStorage();
      this.stopIfFailed();
    }
  }

  private stopIfFailed(): void {
    if (this.error) {
      throw new Error(this.error);
    }
  }

  private async waitForCopyToSettle(checks = 0): Promise<void> {
    const migration = this.currentMigration();
    if (migration && !migration.dryRun && this.migrationActive(migration)) {
      if (checks >= MOVE_PROGRESS_CHECK_LIMIT) {
        throw new Error("The copy is still running after an hour, so the site has not been switched over. The Latest Result tab shows how far it got.");
      } else {
        await new Promise(resolve => setTimeout(resolve, MOVE_PROGRESS_CHECK_MS));
        this.selectedMigration = await firstValueFrom(this.migrationService.migration(migration.migrationId));
        await this.waitForCopyToSettle(checks + 1);
      }
    } else {
      await this.loadHistory();
    }
  }

  async plan(): Promise<void> {

    await this.run("plan", async () => {
      this.selectedMigration = await firstValueFrom(this.migrationService.planMongoOnlyMigration({
        ...this.requestToSend(),
        dryRun: true
      }));
      await this.loadHistory();
    });
  }

  async execute(rotateCredentials: boolean): Promise<void> {
    await this.run("execute", async () => {
      const migration = await firstValueFrom(this.migrationService.executeMongoOnlyMigration({
        ...this.requestToSend(),
        dryRun: false,
        rotateCredentials
      }));
      this.selectedMigration = migration;
      this.pollMigration(migration.migrationId);
      await this.loadHistory();
    });
  }

  async rotate(): Promise<void> {
    if (this.selectedMigration) {
      const migrationId = this.selectedMigration.migrationId;
      await this.run("rotate", async () => {
        this.selectedMigration = await firstValueFrom(this.migrationService.rotateMongoCredentials({
          migrationId,
          confirmEnvironment: this.request.confirmEnvironment || "",
          ...(this.includeMongo() && this.databaseReady() ? { targetMongo: this.request.targetMongo } : {}),
          ...(this.includeS3() ? { targetAws: this.request.targetAws } : {}),
          rotateS3Credentials: this.request.rotateS3Credentials
        }));
        await this.loadHistory();
        this.selectRemainingMigration();
        void this.prepareRamblersStorage();
      });
    }
  }

  selectMigration(migration: EnvironmentMigrationAudit): void {
    this.selectedMigration = migration;
    this.request.environment = migration.environment;
    this.request.targetMongo.cluster = migration.targetMongo?.cluster || this.request.targetMongo.cluster;
    this.request.targetMongo.db = migration.targetMongo?.db || this.request.targetMongo.db;
    this.request.targetMongo.username = migration.targetMongo?.username || this.request.targetMongo.username;
    this.request.mode = migration.mode;
    this.request.targetAws = {
      bucket: migration.targetAws?.bucket || "",
      region: migration.targetAws?.region || AWS_DEFAULTS.REGION,
      accessKeyId: migration.targetAws?.accessKeyId || "",
      secretAccessKey: migration.targetAws && this.request.targetAws.accessKeyId === migration.targetAws.accessKeyId ? this.request.targetAws.secretAccessKey || "" : ""
    };
    this.selectTab(EnvironmentMigrationTab.RESULT);
    void this.loadHistory();
  }

  statusClass(status: string): string {
    return status.replace(/_/g, "-").replace(/\s+/g, "-");
  }

  s3Rows(migration: EnvironmentMigrationAudit): any[] {
    return [...(migration.s3Backups || []), ...(migration.s3Restores || [])];
  }

  trackMigration(_index: number, migration: EnvironmentMigrationAudit): string {
    return migration.migrationId;
  }

  trackCollectionCount(_index: number, row: any): string {
    return row.collection;
  }

  trackS3Summary(index: number, row: any): string {
    return `${row.site}-${row.timestamp}-${index}`;
  }

  migrationStageLabel(migration: EnvironmentMigrationAudit): string {
    const stages: Record<string, string> = {
      [EnvironmentMigrationPhase.PLAN]: "Preparing the migration",
      [EnvironmentMigrationPhase.VALIDATE_SOURCE]: "Checking the current database",
      [EnvironmentMigrationPhase.VALIDATE_TARGET]: "Checking the login on the new cluster",
      [EnvironmentMigrationPhase.DUMP_SOURCE]: "Backing up the current database",
      [EnvironmentMigrationPhase.COPY_S3]: "Copying files",
      [EnvironmentMigrationPhase.RESTORE_TARGET]: "Restoring into the new cluster",
      [EnvironmentMigrationPhase.VERIFY_TARGET]: "Checking the copy matches the original",
      [EnvironmentMigrationPhase.ROTATE_CREDENTIALS]: "Switching the site to the new cluster"
    };
    return stages[migration.phase] || "Working";
  }

  migrationActive(migration: EnvironmentMigrationAudit): boolean {
    const activeStatuses: EnvironmentMigrationStatus[] = [
      EnvironmentMigrationStatus.PENDING,
      EnvironmentMigrationStatus.VALIDATING,
      EnvironmentMigrationStatus.DUMPING,
      EnvironmentMigrationStatus.RESTORING,
      EnvironmentMigrationStatus.VERIFYING
    ];
    return activeStatuses.includes(migration.status as EnvironmentMigrationStatus);
  }

  private async prepareRamblersStorage(): Promise<void> {
    if (this.request.environment && this.includeS3() && !this.filesReady()) {
      await this.useRamblersStorage();
    }
  }


  private copied(): boolean {
    return this.siteMoved() || migrationAllowsCredentialRotation(this.currentMigration());
  }

  private siteMoved(): boolean {
    return this.currentMigration()?.status === EnvironmentMigrationStatus.ROTATED;
  }

  private currentMigration(): EnvironmentMigrationAudit | null {
    return this.selectedMigration && this.selectedMigration.environment === this.request.environment ? this.selectedMigration : null;
  }

  private environmentConfig() {
    return this.environmentsConfig?.environments?.find(environment => environment.environment === this.request.environment);
  }

  private emptyTargetAws() {
    return {bucket: "", region: AWS_DEFAULTS.REGION, accessKeyId: "", secretAccessKey: ""};
  }

  private selectRemainingMigration(): void {
    const forEnvironment = this.history.filter(migration => migration.environment === this.request.environment);
    const switched = forEnvironment.filter(migration => migration.status === EnvironmentMigrationStatus.ROTATED);
    const databaseMoved = switched.some(migration => migrationIncludesMongo(migration.mode));
    const filesMoved = switched.some(migration => migrationIncludesS3(migration.mode));
    const hasMongo = this.environmentsWithMongo.some(environment => environment.name === this.request.environment);
    const databaseLeft = hasMongo && !databaseMoved;
    const filesLeft = !!this.sourceBucket() && !filesMoved;
    const repeatDatabaseMove = hasMongo && databaseMoved && !this.serverChosen ? repeatDatabaseMoveUnderway(forEnvironment) : null;
    const requestedMode = this.requestedMigrationMode();
    if (requestedMode) {
      this.request.mode = requestedMode;
      this.selectedMigration = forEnvironment.find(migration => migration.mode === requestedMode) || null;
    } else if (hasMongo && databaseMoved && this.serverChosen) {
      this.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
      this.selectedMigration = resumableMove(forEnvironment, EnvironmentMigrationMode.MONGO_ONLY, this.request.targetMongo.cluster);
    } else if (repeatDatabaseMove) {
      this.request.mode = EnvironmentMigrationMode.MONGO_ONLY;
      this.request.targetMongo = {...this.request.targetMongo, cluster: repeatDatabaseMove.targetMongo?.cluster || ""};
      this.serverChosen = !!this.request.targetMongo.cluster;
      this.selectedMigration = repeatDatabaseMove;
    } else if (databaseLeft || filesLeft) {
      if (databaseMoved) {
        this.request.targetMongo = {...this.request.targetMongo, cluster: ""};
      }
      this.request.mode = databaseLeft && filesLeft ? EnvironmentMigrationMode.MONGO_AND_S3 : databaseLeft ? EnvironmentMigrationMode.MONGO_ONLY : EnvironmentMigrationMode.S3_ONLY;
      this.selectedMigration = forEnvironment.find(migration => migration.mode === this.request.mode && migration.status !== EnvironmentMigrationStatus.ROTATED) || null;
    } else {
      this.selectedMigration = switched[0] || null;
    }
    this.request.rotateS3Credentials = this.request.mode !== EnvironmentMigrationMode.MONGO_ONLY;
    if (this.copying() && this.pollingMigrationId !== this.selectedMigration.migrationId) {
      this.pollMigration(this.selectedMigration.migrationId);
    }
  }

  private copying(): boolean {
    const migration = this.currentMigration();
    return !!migration && !migration.dryRun && this.migrationActive(migration);
  }

  private requestToSend(): EnvironmentMigrationRequest {
    const { targetAws, targetMongo, ...request } = this.request;
    return {
      ...request,
      ...(this.includeMongo() ? { targetMongo } : {}),
      ...(this.includeS3() ? { targetAws } : {})
    };
  }

  private async run(action: string, operation: () => Promise<void>): Promise<void> {
    this.error = "";
    this.busy = true;
    this.busyAction = action;
    try {
      await operation();
    } catch (error: any) {
      this.logger.error(`Migration ${action} failed:`, error);
      this.error = this.extractErrorMessage(error, `Migration ${action} failed`);
    } finally {
      this.busy = false;
      this.busyAction = "";
    }
  }

  private pollMigration(migrationId: string, attempt = 0): void {
    this.pollingMigrationId = migrationId;
    setTimeout(async () => {
      if (this.pollingMigrationId === migrationId) {
        try {
          const migration = await firstValueFrom(this.migrationService.migration(migrationId));
          if (this.pollingMigrationId === migrationId && migration.environment === this.request.environment) {
            this.selectedMigration = migration;
            await this.loadHistory();
            if (this.migrationActive(migration) && attempt < 720) {
              this.pollMigration(migrationId, attempt + 1);
            } else {
              this.pollingMigrationId = null;
              if (migration.status === EnvironmentMigrationStatus.FAILED) {
                this.error = migration.error || "Migration failed";
              } else if (migration.status === EnvironmentMigrationStatus.ORPHANED) {
                this.error = migration.error || "Migration was interrupted by a server restart";
              }
            }
          } else if (this.pollingMigrationId === migrationId) {
            this.pollingMigrationId = null;
          }
        } catch (error: any) {
          if (this.pollingMigrationId === migrationId) {
            this.pollingMigrationId = null;
          }
          this.logger.error("Migration polling failed:", error);
        }
      }
    }, 5000);
  }

  private extractErrorMessage(error: any, fallback: string): string {
    return error?.error?.error || error?.error?.message || error?.message || fallback;
  }
}
