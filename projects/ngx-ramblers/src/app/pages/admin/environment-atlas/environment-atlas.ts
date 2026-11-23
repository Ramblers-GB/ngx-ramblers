import { sortDirectionFromParam, sortDirectionParam } from "../../../functions/sort-direction";
import { enumValues } from "../../../functions/enums";
import { UiActionsService } from "../../../services/ui-actions.service";
import { Component, ElementRef, inject, OnDestroy, OnInit } from "@angular/core";
import { EnvironmentSiteLinksComponent } from "../../../modules/common/environment-site-links/environment-site-links";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation, faExternalLinkAlt, faFloppyDisk, faGlobe, faKey, faLayerGroup, faArrowsRotate, faPlus, faSpinner, faStar, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { TooltipDirective } from "ngx-bootstrap/tooltip";
import { TabDirective, TabsetComponent } from "ngx-bootstrap/tabs";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import {
  ATLAS_CONNECTION_LIMIT,
  AtlasAlertStatus,
  AtlasClusterAlert,
  ATLAS_CLEANUP_CONFIRMATION_WORD,
  AtlasCleanupAttempt,
  AtlasCleanupItem,
  AtlasCleanupKind,
  AtlasCleanupOutcome,
  AtlasGhostDatabase,
  cleanupNeedsTypedConfirmation,
  cleanupSelectionSummary,
  ghostCleanupItem,
  loginsCleanupItem,
  AtlasLeftoverLogin,
  AtlasLeftoverLoginGroup,
  ghostDatabaseLogins,
  spareLoginGroups,
  atlasAlertLabel,
  connectionPercent,
  connectionsNearLimit,
  openAtlasAlerts,
  AtlasClusterCreateRequest,
  AtlasClusterSortField,
  AtlasEnvironmentSortField,
  AtlasClusterEnvironmentRow,
  AtlasClusterRow,
  AtlasClusterState,
  AtlasClusterTier,
  AtlasClusterView,
  EnvironmentAtlasTab,
  clusterCanBeDeleted,
  clusterDisplayName,
  atlasTierLabel,
  clusterFullness,
  ClusterFullnessLevel,
  isSharedTier,
  nextSharedSitesClusterName,
  siteDatabaseWarning
} from "../../../models/atlas-cluster.model";
import { AdminPlatformPath } from "../../../models/admin-route-paths.model";
import { EnvironmentSetupTab } from "../../../models/environment-setup.model";
import { EnvironmentSettingsSubTab } from "../../../models/system.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { AwsRegion, awsRegionLabel } from "../../../models/environment-config.model";
import { toKebabCase } from "../../../functions/strings";
import { ASCENDING, DESCENDING } from "../../../models/table-filtering.model";
import { SortableTableAlignment, SortableTableColumn, SortableTableSortState } from "../../../modules/common/sortable-table/sortable-table.model";
import { SortableTableCellDirective } from "../../../modules/common/sortable-table/sortable-table-cell.directive";
import { SortableTableComponent } from "../../../modules/common/sortable-table/sortable-table.component";
import { VendorBrandMarkComponent } from "../../../modules/common/vendor-brand-mark/vendor-brand-mark.component";
import { ConsoleAccessLinksComponent } from "../../../modules/common/console-access-links/console-access-links";
import { MongoClusterSelectComponent } from "../../../modules/common/selectors/mongo-cluster-select";
import { ConsoleAccessUrlIconKey, MONGODB_ATLAS_CONSOLE_URLS, MongoClusterInfo } from "../../../models/environment-setup.model";
import { resolveConsoleUrls } from "../../../functions/console-access-urls";
import { PageComponent } from "../../../page/page.component";
import { EnvironmentSetupService } from "../../../services/environment-setup/environment-setup.service";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { AlertInstance, NotifierService } from "../../../services/notifier.service";
import { AlertTarget } from "../../../models/alert-target.model";
import { AlertPanelVariant } from "../../../models/alert-panel.model";
import { AlertPanelComponent } from "../../../modules/common/alert-panel/alert-panel";
import { DateUtilsService } from "../../../services/date-utils.service";

@Component({
  selector: "app-environment-atlas",
  imports: [
    FormsModule,
    TooltipDirective,
    FontAwesomeModule,
    RouterLink,
    TabsetComponent,
    TabDirective,
    PageComponent,
    SortableTableComponent,
    SortableTableCellDirective,
    VendorBrandMarkComponent,
    ConsoleAccessLinksComponent,
    MongoClusterSelectComponent,
    AlertPanelComponent,
    EnvironmentSiteLinksComponent
  ],
  styles: [`
    .atlas-cluster-name
      white-space: nowrap
    .row-action-icon
      border: 0
      background: transparent
      padding: 0.25rem 0.4rem
      color: var(--bs-secondary-color)
      line-height: 1
      cursor: pointer
    .row-action-icon:disabled
      opacity: .5
      cursor: not-allowed
    .row-action-default:not(:disabled):hover, .row-action-default:not(:disabled):focus-visible
      color: var(--ramblers-colour-sunrise, #f9b104)
    .ghost-databases
      display: flex
      flex-wrap: wrap
      gap: 0.25rem
      margin-top: 0.3rem
    .ghost-database
      display: inline-flex
      align-items: center
      gap: 0.25rem
      padding: 0 0.4rem
      border: 1px dashed var(--bs-secondary-color)
      border-radius: 1rem
      color: var(--bs-secondary-color)
      font-size: 0.75rem
      line-height: 1.5
      white-space: nowrap
    .ghost-database-key
      font-size: 0.65rem
    .ghost-database-count
      font-weight: 600
    .ghost-database-delete
      padding: 0
      border: 0
      background: none
      color: inherit
      font-size: 0.7rem
      cursor: pointer
    .ghost-database-delete:not(:disabled):hover, .ghost-database-delete:not(:disabled):focus-visible
      color: var(--bs-danger)
    .ghost-database-selected
      border-style: solid
      border-color: var(--bs-danger)
      color: var(--bs-danger)
    .atlas-cleanup-list
      padding-left: 1.25rem
    .row-action-default-selected
      display: inline-block
      color: var(--ramblers-colour-sunrise, #f9b104)
      cursor: default
    .row-action-delete:not(:disabled):hover, .row-action-delete:not(:disabled):focus-visible
      color: var(--bs-danger)
    .cluster-fullness
      min-width: 13rem
    .cluster-fullness-label
      display: flex
      align-items: center
      justify-content: space-between
      gap: 0.5rem
      font-size: 0.8rem
    .cluster-fullness-label .fw-bold
      white-space: nowrap
      flex-shrink: 0
    .cluster-fullness .progress
      height: 6px
    .row > .atlas-delete-confirmation
      width: auto
      margin-left: calc(var(--bs-gutter-x) * .5)
      margin-right: calc(var(--bs-gutter-x) * .5)
      padding-left: 1rem
      padding-right: 1rem

    .atlas-loading
      display: flex
      align-items: flex-start
      gap: 0.75rem
      padding: 2rem 1rem
      color: var(--bs-secondary-color)
    .cluster-fullness-note
      font-size: 0.75rem
      color: var(--bs-secondary-color)
      margin-top: 0.15rem
      white-space: normal
    .atlas-action-links
      display: flex
      flex-direction: row
      flex-wrap: wrap
      align-items: center
      gap: 0.35rem 0.85rem
    .atlas-action-link
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
      cursor: pointer
    .atlas-action-link:disabled
      opacity: 0.55
      cursor: not-allowed
  `],
  template: `
    <app-page autoTitle pageTitle="MongoDB Atlas">
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
      @if (!loading && clustersNeedingAttention().length) {
        <div class="alert alert-warning d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
          <div>
            <strong>MongoDB Atlas connections need attention</strong>
            @for (cluster of clustersNeedingAttention(); track cluster.host) {
              <div>{{ attentionSummary(cluster) }}</div>
            }
          </div>
        </div>
      }
      @if (errorMessage) {
        <div class="alert alert-danger d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
          <div>
            <strong>Could not load Atlas</strong>
            <div>{{ errorMessage }}</div>
          </div>
        </div>
      }
      @if (view?.registrationBlocked) {
        <div class="alert alert-warning d-flex align-items-start">
          <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
          <div>
            <strong>New group registration will fail</strong>
            <div>{{ view.registrationBlockReason }} New sites currently go to <code>{{ view.registrationCluster }}</code>. Create a cluster in Clusters and set it as the default.</div>
          </div>
        </div>
      }
      <tabset class="custom-tabset">
      <tab heading="Cluster inventory" [active]="activeTab === EnvironmentAtlasTab.CLUSTERS" (selectTab)="selectTab(EnvironmentAtlasTab.CLUSTERS)">
      <div class="row thumbnail-heading-frame mb-4">
        <div class="thumbnail-heading">Clusters</div>
        <div class="mt-2 mb-3 d-flex flex-wrap gap-2">
          <a class="btn btn-primary" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_COLLECTION_CLEANUP">
            <fa-icon [icon]="faLayerGroup" class="me-1"/>Clean up empty collections
          </a>
          <button type="button" class="btn btn-primary" [disabled]="loading" (click)="load()">
            <fa-icon [icon]="loading ? faSpinner : faArrowsRotate" [animation]="loading ? 'spin' : undefined" class="me-1"/>{{ loading ? "Refreshing" : "Refresh" }}
          </button>
        </div>
        @if (cleanupSelection.length) {
          <div class="alert alert-warning mb-3 atlas-delete-confirmation">
            <fa-icon [icon]="faCircleExclamation" class="me-1"/>
            <strong>Delete {{ cleanupSelectionSummary(cleanupSelection) }}</strong>
            <ul class="atlas-cleanup-list mt-1 mb-1">
              @for (item of cleanupSelection; track item.key) {
                <li>
                  @if (cleanupCurrentKey === item.key) {
                    <fa-icon [icon]="faSpinner" animation="spin" class="me-1"/>
                  }
                  {{ item.label }} <span class="text-muted">on {{ item.cluster }}</span>
                </li>
              }
            </ul>
            <div>Deleting is permanent and cannot be undone.@if (cleanupNeedsTypedConfirmation(cleanupSelection)) { Each database is removed with its unused logins; one already removed by hand is simply cleared from this list. Each can take a minute while Atlas sets up access. Type {{ ATLAS_CLEANUP_CONFIRMATION_WORD }} to confirm.} Click more bins to add to this list.</div>
            <div class="d-flex align-items-center flex-wrap gap-2 mt-2">
              @if (cleanupNeedsTypedConfirmation(cleanupSelection)) {
                <input class="form-control w-auto" name="cleanupConfirmation" [(ngModel)]="cleanupConfirmation" autocomplete="off" [placeholder]="ATLAS_CLEANUP_CONFIRMATION_WORD">
              }
              <button type="button" class="btn btn-danger" [disabled]="cleaningUp || !cleanupConfirmed()" (click)="runCleanup()">
                <fa-icon [icon]="cleaningUp ? faSpinner : faTrash" [animation]="cleaningUp ? 'spin' : undefined" class="me-1"/>{{ cleaningUp ? cleanupProgress : "Delete " + cleanupSelectionSummary(cleanupSelection) }}
              </button>
              <button type="button" class="btn btn-quiet" [disabled]="cleaningUp" (click)="clearCleanup()"><fa-icon [icon]="faXmark" class="me-1"/>Clear selection</button>
            </div>
          </div>
        }
        @if (deleteTarget) {
          <div class="alert alert-warning mb-3 atlas-delete-confirmation">
            <fa-icon [icon]="faCircleExclamation" class="me-1"/>
            <strong>Delete cluster {{ deleteTarget.name }}</strong>
            <div class="mt-1">Atlas deletes the cluster and everything on it, and this cannot be undone. No site uses it. Type the cluster name to confirm.</div>
            <div class="d-flex align-items-center flex-wrap gap-2 mt-2">
              <input class="form-control w-auto" name="deleteConfirmation" [(ngModel)]="deleteConfirmation" autocomplete="off" [placeholder]="deleteTarget.name">
              <button type="button" class="btn btn-danger" [disabled]="deleting || deleteConfirmation !== deleteTarget.name" (click)="deleteCluster()">
                <fa-icon [icon]="deleting ? faSpinner : faTrash" [animation]="deleting ? 'spin' : undefined" class="me-1"/>Delete cluster
              </button>
              <button type="button" class="btn btn-quiet" [disabled]="deleting" (click)="cancelDelete()"><fa-icon [icon]="faXmark" class="me-1"/>Cancel</button>
            </div>
          </div>
        }
        @if (loading && !view) {
          <div class="atlas-loading">
            <fa-icon [icon]="faSpinner" animation="spin"/>
            <div>
              <strong>Loading clusters</strong>
              <div>Reading each cluster's size, load and connections from Atlas.</div>
            </div>
          </div>
        } @else {
        <app-sortable-table
          [columns]="clusterColumns"
          [rows]="view?.clusters || []"
          [defaultSortKey]="clusterSortKey"
          [defaultSortDirection]="clusterSortDirection"
          [trackBy]="trackCluster"
          filterable
          fillWindow
          [fillWindowGapPx]="90"
          [filterStoredValue]="StoredValue.ATLAS_CLUSTER_FILTER"
          emptyMessage="No clusters yet. Use the New cluster tab, or existing group clusters will appear here from environment configuration."
          (sortChange)="clusterSortChanged($event)">
          <ng-template [appSortableTableCell]="AtlasClusterSortField.NAME" let-row>
            <div class="atlas-cluster-name">{{ row.name }}</div>
            @if (!row.inProvisioningProject) {
              <div><span class="badge-cloudy">External project</span></div>
            }
            <div class="d-flex align-items-center flex-wrap gap-2 mt-2">
              @if (clusterConsoleLinks(row).length) {
                <app-vendor-brand-mark serviceId="mongodbAtlas" [sizePx]="18" [inline]="true"/>
              }
              <app-console-access-links class="d-inline-flex" [links]="clusterConsoleLinks(row)" [showEmpty]="false"/>
              @if (row.region) {
                <span class="text-muted text-nowrap">{{ awsRegionLabel(row.region) }}</span>
              }
            </div>
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasClusterSortField.SIZE" let-row>
            <span [tooltip]="row.stateName">{{ atlasTierLabel(row.instanceSize) }}</span>
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasClusterSortField.ENVIRONMENTS" let-row>
            <app-environment-site-links moveLinks [sites]="row.sites || []"/>
            @if (row.ghostDatabases?.length || row.leftoverLogins?.length) {
              <div class="ghost-databases">
                @for (ghost of row.ghostDatabases || []; track ghost.migrationId) {
                  @let ghostItem = ghostCleanupItem(row, ghost);
                  <span class="ghost-database" [class.ghost-database-selected]="cleanupSelected(ghostItem)" [tooltip]="ghostDescription(row, ghost)" placement="right" container="body" containerClass="ghost-database-tooltip">
                    {{ ghost.environment }}
                    @for (login of ghostItem.logins; track login.username) {
                      <fa-icon [icon]="faKey" class="ghost-database-key"/>
                    }
                    @if (row.inProvisioningProject && row.projectId) {
                      <button type="button" class="ghost-database-delete" [attr.aria-pressed]="cleanupSelected(ghostItem)" [attr.aria-label]="(cleanupSelected(ghostItem) ? 'Keep the copy ' : 'Choose to delete the copy ') + ghost.environment + ' left behind'" [disabled]="cleaningUp" (click)="toggleCleanup(ghostItem)"><fa-icon [icon]="cleanupCurrentKey === ghostItem.key ? faSpinner : faTrash" [animation]="cleanupCurrentKey === ghostItem.key ? 'spin' : undefined"/></button>
                    }
                  </span>
                }
                @for (group of spareLoginGroups(row); track group.environment) {
                  @let loginsItem = loginsCleanupItem(row, group);
                  <span class="ghost-database" [class.ghost-database-selected]="cleanupSelected(loginsItem)" [tooltip]="spareLoginsDescription(group)" placement="right" container="body" containerClass="ghost-database-tooltip">
                    <fa-icon [icon]="faKey" class="ghost-database-key"/>{{ group.environment }}@if (group.logins.length > 1) { <span class="ghost-database-count">{{ group.logins.length }}</span> }
                    <button type="button" class="ghost-database-delete" [attr.aria-pressed]="cleanupSelected(loginsItem)" [attr.aria-label]="(cleanupSelected(loginsItem) ? 'Keep the unused logins for ' : 'Choose to delete the unused logins for ') + group.environment" [disabled]="cleaningUp" (click)="toggleCleanup(loginsItem)"><fa-icon [icon]="cleanupCurrentKey === loginsItem.key ? faSpinner : faTrash" [animation]="cleanupCurrentKey === loginsItem.key ? 'spin' : undefined"/></button>
                  </span>
                }
              </div>
            }
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasClusterSortField.COLLECTIONS" let-row>
            @let fullness = clusterFullness(row);
            <div class="cluster-fullness" [tooltip]="row.limitHeadline">
              <div class="cluster-fullness-label">
                <span [class.text-danger]="!row.canAddEnvironment">{{ fullness.collections.label }}</span>
                <span class="fw-bold">{{ fullness.collections.percent }}%</span>
                @if (!row.canAddEnvironment) {
                  <fa-icon [icon]="faCircleExclamation" class="text-danger"/>
                }
              </div>
              <div class="progress" role="progressbar" [attr.aria-valuenow]="fullness.collections.percent" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar" [class]="fullnessBarClass(fullness.collections.level)" [style.width.%]="fullness.collections.percent"></div>
              </div>
              @if (fullness.storage) {
                <div class="cluster-fullness-label mt-1">
                  <span>{{ fullness.storage.label }}</span>
                  <span class="fw-bold">{{ fullness.storage.percent }}%</span>
                </div>
                <div class="progress" role="progressbar" [attr.aria-valuenow]="fullness.storage.percent" aria-valuemin="0" aria-valuemax="100">
                  <div class="progress-bar" [class]="fullnessBarClass(fullness.storage.level)" [style.width.%]="fullness.storage.percent"></div>
                </div>
              }
              @if (fullness.load) {
                <div class="cluster-fullness-label mt-1">
                  <span>{{ fullness.load.label }}</span>
                  <span class="fw-bold">{{ fullness.load.percent }}%</span>
                </div>
                <div class="progress" role="progressbar" [attr.aria-valuenow]="fullness.load.percent" aria-valuemin="0" aria-valuemax="100">
                  <div class="progress-bar" [class]="fullnessBarClass(fullness.load.level)" [style.width.%]="fullness.load.percent"></div>
                </div>
              }
              @if (fullness.loadNote) {
                <div class="cluster-fullness-note">{{ fullness.loadNote }}</div>
              }
              @if (fullness.connections) {
                <div class="cluster-fullness-label mt-1">
                  <span>{{ fullness.connections.label }}</span>
                  <span class="fw-bold">{{ fullness.connections.percent }}%</span>
                </div>
                <div class="progress" role="progressbar" [attr.aria-valuenow]="fullness.connections.percent" aria-valuemin="0" aria-valuemax="100">
                  <div class="progress-bar" [class]="fullnessBarClass(fullness.connections.level)" [style.width.%]="fullness.connections.percent"></div>
                </div>
                <div class="cluster-fullness-note">{{ fullness.connectionsNote }}</div>
              }
              @for (alert of row.alerts || []; track alert.id) {
                <div class="cluster-fullness-note" [class.text-danger]="alert.status !== AtlasAlertStatus.CLOSED">
                  <fa-icon [icon]="faCircleExclamation" class="me-1"/>{{ alertSummary(alert) }}
                </div>
              }
            </div>
          </ng-template>
          <ng-template [appSortableTableCell]="'actions'" let-row>
            @if (row.isDefault) {
              <span class="row-action-icon row-action-default-selected" tooltip="Default for new sites" aria-label="Default for new sites"><fa-icon [icon]="faStar"/></span>
            } @else if (row.host) {
              <button type="button" class="row-action-icon row-action-default" tooltip="Use this cluster for new sites" aria-label="Use this cluster for new sites" [disabled]="saving" (click)="setDefaultCluster(row.host)"><fa-icon [icon]="faStar"/></button>
            }
            @if (clusterCanBeDeleted(row, view?.projectId)) {
              <button type="button" class="row-action-icon row-action-delete ms-1" tooltip="Delete this empty cluster" aria-label="Delete this empty cluster" [disabled]="deleting" (click)="startDelete(row)"><fa-icon [icon]="faTrash"/></button>
            }
          </ng-template>
        </app-sortable-table>
        }
        <div class="mt-3">
          <button type="button" class="btn btn-quiet" [disabled]="!view?.keysConfigured || !projectId" (click)="allowNetwork()"><fa-icon [icon]="faGlobe" class="me-1"/>Allow Fly connections</button>
          @if (view?.networkAccess?.length) {
            <div class="small text-muted mt-2">Network access: {{ networkAccessSummary() }}</div>
          }
        </div>
      </div>
      </tab>
      <tab heading="New cluster" [active]="activeTab === EnvironmentAtlasTab.NEW_CLUSTER" (selectTab)="selectTab(EnvironmentAtlasTab.NEW_CLUSTER)">
      <div class="row thumbnail-heading-frame mb-4">
        <div class="thumbnail-heading">Create cluster</div>
        <p class="mb-3">M0 and Flex are only offered in AWS Ireland; London is for dedicated tiers. Flex is the cheapest paid tier and takes several sites, up to 500 collections and 100 databases, so it can stay in the main project. Atlas permits one M0 per project, so an M0 needs a separate project. Check the cluster inventory before moving sites onto a cluster. Nothing is created in Atlas until you press Create cluster.</p>
        <div class="row">
          <div class="col-md-4 mb-2">
            <label class="form-label" for="new-cluster-name">Name</label>
            <input id="new-cluster-name" class="form-control" name="newClusterName" [(ngModel)]="createRequest.name" autocomplete="off"
                   placeholder="ngx-shared-sites-01">
            <div class="form-text">A cluster shared by several group sites is named ngx-shared-sites- followed by the next number. A cluster for one group is named after the group, for example kent.</div>
          </div>
          <div class="col-md-4 mb-2">
            <label class="form-label" for="new-cluster-tier">Tier</label>
            <select id="new-cluster-tier" class="form-control" name="newClusterTier" [(ngModel)]="createRequest.tier" (ngModelChange)="tierChanged($event)">
              <option [value]="AtlasClusterTier.M0">M0 free (one per project, 500 collections)</option>
              <option [value]="AtlasClusterTier.FLEX">Flex ($8–30/month, 500 collections)</option>
              <option [value]="AtlasClusterTier.M10">M10 dedicated</option>
              <option [value]="AtlasClusterTier.M20">M20 dedicated (live groups)</option>
              <option [value]="AtlasClusterTier.M30">M30 dedicated</option>
            </select>
          </div>
          <div class="col-md-4 mb-2">
            <label class="form-label">Region</label>
            <select class="form-control" name="clusterRegion" [(ngModel)]="createRequest.region">
              <option [value]="AwsRegion.EU_WEST_1">{{ awsRegionLabel(AwsRegion.EU_WEST_1) }}</option>
              <option [value]="AwsRegion.EU_WEST_2" [disabled]="isSharedTier(createRequest.tier)">{{ awsRegionLabel(AwsRegion.EU_WEST_2) }}</option>
            </select>
          </div>
        </div>
        <div class="form-check ms-4 mt-2">
          <input class="form-check-input" type="checkbox" id="separate-project" name="separateProject" [(ngModel)]="createRequest.separateProject">
          <label class="form-check-label" for="separate-project">Create in a separate Atlas project (Organisation Project Creator required)</label>
        </div>
        <div class="form-check ms-4 mt-2">
          <input class="form-check-input" type="checkbox" id="set-as-default" name="setAsDefault" [(ngModel)]="createRequest.setAsDefault">
          <label class="form-check-label" for="set-as-default">Set as the default cluster for new sites once Atlas gives us a hostname</label>
        </div>
        <div class="form-check ms-4 mt-2">
          <input class="form-check-input" type="checkbox" id="allow-network" name="allowAllNetworkAccess" [(ngModel)]="createRequest.allowAllNetworkAccess">
          <label class="form-check-label" for="allow-network">Allow connections from anywhere (needed for Fly)</label>
        </div>
        <div class="mt-3">
          <button type="button" class="btn btn-primary" [disabled]="creating || !view?.keysConfigured || !projectId" (click)="createCluster()">
            @if (creating) {
              <fa-icon [icon]="faSpinner" animation="spin" class="me-1"/>
            } @else {
              <fa-icon [icon]="faPlus" class="me-1"/>
            }
            Create cluster
          </button>
        </div>
      </div>
      </tab>
      <tab heading="Environments" [active]="activeTab === EnvironmentAtlasTab.ENVIRONMENTS" (selectTab)="selectTab(EnvironmentAtlasTab.ENVIRONMENTS)">
      <div class="row thumbnail-heading-frame mb-4">
        <div class="thumbnail-heading">Environments</div>
        <div class="mt-2 mb-3">
          <button type="button" class="btn btn-primary" [disabled]="loading" (click)="load()">
            <fa-icon [icon]="loading ? faSpinner : faArrowsRotate" [animation]="loading ? 'spin' : undefined" class="me-1"/>{{ loading ? "Refreshing" : "Refresh" }}
          </button>
        </div>
        @if (loading && !view) {
          <div class="atlas-loading">
            <fa-icon [icon]="faSpinner" animation="spin"/>
            <div>
              <strong>Loading environments</strong>
              <div>Counting the collections in each environment's database.</div>
            </div>
          </div>
        } @else {
        <app-sortable-table
          [columns]="environmentColumns"
          [rows]="view?.environments || []"
          [defaultSortKey]="environmentSortKey"
          [defaultSortDirection]="environmentSortDirection"
          [trackBy]="trackEnvironment"
          filterable
          fillWindow
          [filterStoredValue]="StoredValue.ATLAS_ENVIRONMENT_FILTER"
          emptyMessage="No environments in platform configuration."
          (sortChange)="environmentSortChanged($event)">
          <ng-template [appSortableTableCell]="AtlasEnvironmentSortField.ENVIRONMENT" let-row>
            <app-environment-site-links moveLinks [sites]="[{environment: row.environment, url: row.siteUrl, warning: siteDatabaseWarning(row.liveDatabase, row.cluster)}]"/>
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasEnvironmentSortField.CLUSTER" let-row>
            {{ clusterDisplayName(row.cluster) }}
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasEnvironmentSortField.DATABASE" let-row>
            {{ row.database }}
            @if (environmentConsoleLinks(row).length) {
              <div class="d-flex align-items-center gap-2 mt-2">
                <app-vendor-brand-mark serviceId="mongodbAtlas" [sizePx]="18" [inline]="true"/>
                <app-console-access-links [links]="environmentConsoleLinks(row)" [showEmpty]="false"/>
              </div>
            }
          </ng-template>
          <ng-template [appSortableTableCell]="AtlasEnvironmentSortField.COLLECTIONS" let-row>
            @if (row.error) {
              <app-alert-panel compact title="Could not count collections"
                               [icon]="faCircleExclamation" [variant]="AlertPanelVariant.DANGER">
                {{ row.error }}
              </app-alert-panel>
            } @else {
              {{ row.collections }} collections, {{ row.indexes }} indexes
            }
          </ng-template>
        </app-sortable-table>
        }
      </div>
      </tab>
      <tab heading="Provisioning" [active]="activeTab === EnvironmentAtlasTab.PROVISIONING" (selectTab)="selectTab(EnvironmentAtlasTab.PROVISIONING)">
      <div class="row thumbnail-heading-frame mb-4">
        <div class="thumbnail-heading with-vendor-logo d-flex align-items-center gap-2">
          <app-vendor-brand-mark serviceId="mongodbAtlas" [sizePx]="26"/>
          <span>Provisioning home</span>
        </div>
        <p class="mb-3">This is the Atlas project new sites are born in. It is separate from the content template. Existing group rows stay on their current clusters until you move them with Environment Migration.</p>
        <div class="row">
          <div class="col-md-6 mb-2">
            <label class="form-label" for="atlas-project-id">Project ID</label>
            <input id="atlas-project-id" class="form-control" name="atlasProjectId" [(ngModel)]="projectId" autocomplete="off"
                   placeholder="24-character id from Atlas Project Settings">
          </div>
          <div class="col-md-6 mb-2">
            <label class="form-label" for="atlas-default-cluster">Default cluster for new sites</label>
            <app-mongo-cluster-select id="atlas-default-cluster"
                                      [clusters]="defaultClusterChoices"
                                      [selected]="selectedDefaultCluster"
                                      [clearable]="true"
                                      [disabled]="loading || saving"
                                      placeholder="Select a cluster"
                                      (selectedChange)="defaultClusterChanged($event)"/>
          </div>
        </div>
        <div class="atlas-action-links mt-2">
          <button type="button" class="atlas-action-link" [disabled]="saving" (click)="saveProvisioning()">
            @if (saving) {
              <fa-icon [icon]="faSpinner" animation="spin"/>
            } @else {
              <fa-icon [icon]="faFloppyDisk"/>
            }
            <span>Save</span>
          </button>
          <a class="atlas-action-link" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_SETUP"
             [queryParams]="environmentSetupGlobalQueryParams">
            <fa-icon [icon]="faKey"/>
            <span>API keys</span>
          </a>
          @if (projectId) {
            <a class="atlas-action-link" [href]="'https://cloud.mongodb.com/v2/' + projectId + '#/overview'" target="_blank" rel="noopener">
              <fa-icon [icon]="faExternalLinkAlt"/>
              <span>Atlas project</span>
            </a>
          }
        </div>
        @if (view && !view.keysConfigured) {
          <div class="alert alert-warning d-flex align-items-start mt-3 mb-0">
            <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
            <div>
              <strong>API keys needed</strong>
              <div>Add the Atlas API public and private key under Global settings before this page can create clusters. The key needs Project Owner, or Project Cluster Manager plus Project Database Access Admin.</div>
            </div>
          </div>
        }
        @if (view?.atlasError) {
          <div class="alert alert-warning d-flex align-items-start mt-3 mb-0">
            <fa-icon [icon]="faCircleExclamation" class="me-2 mt-1"/>
            <div>
              <strong>Atlas API</strong>
              <div>{{ view.atlasError }}</div>
            </div>
          </div>
        }
      </div>
      </tab>
      </tabset>
    </app-page>
  `
})
export class EnvironmentAtlasComponent implements OnInit, OnDestroy {
  private readonly uiActions = inject(UiActionsService);
  private logger: Logger = inject(LoggerFactory).createLogger("EnvironmentAtlasComponent", NgxLoggerLevel.ERROR);
  private environmentSetupService = inject(EnvironmentSetupService);
  private dateUtils = inject(DateUtilsService);
  private notifierService = inject(NotifierService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private subscriptions: Subscription[] = [];
  private notify: AlertInstance;
  public notifyTarget: AlertTarget = {};

  protected readonly faSpinner = faSpinner;
  protected readonly faPlus = faPlus;
  protected readonly faLayerGroup = faLayerGroup;
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly AlertPanelVariant = AlertPanelVariant;
  protected readonly faExternalLinkAlt = faExternalLinkAlt;
  protected readonly faFloppyDisk = faFloppyDisk;
  protected readonly faGlobe = faGlobe;
  protected readonly faKey = faKey;
  protected readonly StoredValue = StoredValue;
  protected readonly siteDatabaseWarning = siteDatabaseWarning;
  protected readonly AdminPlatformPath = AdminPlatformPath;
  protected readonly EnvironmentAtlasTab = EnvironmentAtlasTab;
  protected readonly environmentSetupGlobalQueryParams = {[StoredValue.TAB]: toKebabCase(EnvironmentSetupTab.SETTINGS), [StoredValue.SUB_TAB]: EnvironmentSettingsSubTab.GLOBAL};
  protected readonly AtlasClusterTier = AtlasClusterTier;
  protected readonly isSharedTier = isSharedTier;
  protected readonly clusterFullness = clusterFullness;
  protected readonly clusterDisplayName = clusterDisplayName;
  protected readonly AtlasAlertStatus = AtlasAlertStatus;
  protected readonly atlasTierLabel = atlasTierLabel;
  protected readonly clusterCanBeDeleted = clusterCanBeDeleted;
  protected readonly faTrash = faTrash;
  protected readonly faStar = faStar;
  protected readonly faArrowsRotate = faArrowsRotate;
  protected readonly faXmark = faXmark;
  deleteTarget: AtlasClusterRow | null = null;
  cleanupSelection: AtlasCleanupItem[] = [];
  cleanupConfirmation = "";
  cleaningUp = false;
  cleanupProgress = "";
  cleanupCurrentKey: string | null = null;
  protected readonly ghostCleanupItem = ghostCleanupItem;
  protected readonly loginsCleanupItem = loginsCleanupItem;
  protected readonly cleanupSelectionSummary = cleanupSelectionSummary;
  protected readonly cleanupNeedsTypedConfirmation = cleanupNeedsTypedConfirmation;
  protected readonly ATLAS_CLEANUP_CONFIRMATION_WORD = ATLAS_CLEANUP_CONFIRMATION_WORD;
  deleteConfirmation = "";
  deleting = false;
  protected readonly AwsRegion = AwsRegion;
  protected readonly awsRegionLabel = awsRegionLabel;
  protected readonly AtlasClusterState = AtlasClusterState;
  protected readonly AtlasClusterSortField = AtlasClusterSortField;
  protected readonly AtlasEnvironmentSortField = AtlasEnvironmentSortField;

  view: AtlasClusterView | null = null;
  loading = true;
  saving = false;
  creating = false;
  errorMessage: string | null = null;
  projectId = "";
  defaultCluster = "";
  selectedDefaultCluster: MongoClusterInfo | null = null;
  defaultClusterChoices: MongoClusterInfo[] = [];
  clusterSortKey = AtlasClusterSortField.DEFAULT_FOR_NEW_SITES;
  clusterSortDirection = DESCENDING;
  environmentSortKey = AtlasEnvironmentSortField.ENVIRONMENT;
  environmentSortDirection = ASCENDING;
  activeTab = EnvironmentAtlasTab.CLUSTERS;
  createRequest: AtlasClusterCreateRequest = {
    name: nextSharedSitesClusterName([]),
    tier: AtlasClusterTier.FLEX,
    region: AwsRegion.EU_WEST_1,
    separateProject: false,
    setAsDefault: true,
    allowAllNetworkAccess: true
  };

  clusterColumns: SortableTableColumn<AtlasClusterRow>[] = [
    {key: AtlasClusterSortField.NAME, label: "Cluster", sortKey: AtlasClusterSortField.NAME},
    {key: AtlasClusterSortField.SIZE, label: "Size", sortKey: AtlasClusterSortField.SIZE, cellClass: "text-nowrap", filterText: row => atlasTierLabel(row.instanceSize)},
    {key: AtlasClusterSortField.ENVIRONMENTS, label: "Sites", sortKey: AtlasClusterSortField.ENVIRONMENTS, filterValues: row => (row.sites || []).map(site => site.environment)},
    {key: AtlasClusterSortField.COLLECTIONS, label: "Usage against limits", sortKey: AtlasClusterSortField.COLLECTIONS, filterText: row => row.limitHeadline || "", filterSuggestions: false},
    {key: "actions", label: "", cellClass: "text-nowrap", pinnedEnd: true}
  ];

  environmentColumns: SortableTableColumn<AtlasClusterEnvironmentRow>[] = [
    {key: AtlasEnvironmentSortField.ENVIRONMENT, label: "Environment", sortKey: AtlasEnvironmentSortField.ENVIRONMENT},
    {key: AtlasEnvironmentSortField.CLUSTER, label: "Cluster", sortKey: AtlasEnvironmentSortField.CLUSTER, filterText: row => clusterDisplayName(row.cluster)},
    {key: AtlasEnvironmentSortField.DATABASE, label: "Database", sortKey: AtlasEnvironmentSortField.DATABASE},
    {key: AtlasEnvironmentSortField.COLLECTIONS, label: "Usage", sortKey: AtlasEnvironmentSortField.COLLECTIONS, align: SortableTableAlignment.RIGHT, cellClass: "text-nowrap", filterText: row => row.error || `${row.collections} collections, ${row.indexes} indexes`, filterSuggestions: false}
  ];

  ngOnInit() {
    this.notify = this.notifierService.createAlertInstance(this.notifyTarget);
    this.subscriptions.push(this.activatedRoute.queryParams.subscribe(params => {
      this.activeTab = [EnvironmentAtlasTab.NEW_CLUSTER, EnvironmentAtlasTab.ENVIRONMENTS, EnvironmentAtlasTab.PROVISIONING].includes(params[StoredValue.TAB])
        ? params[StoredValue.TAB]
        : EnvironmentAtlasTab.CLUSTERS;
      this.clusterSortKey = this.uiActions.queryValueForAlias(params[StoredValue.ATLAS_CLUSTER_SORT], enumValues(AtlasClusterSortField)) as AtlasClusterSortField || AtlasClusterSortField.DEFAULT_FOR_NEW_SITES;
      this.clusterSortDirection = sortDirectionFromParam(params[StoredValue.ATLAS_CLUSTER_SORT_ORDER], this.clusterSortKey === AtlasClusterSortField.DEFAULT_FOR_NEW_SITES ? DESCENDING : ASCENDING);
      this.environmentSortKey = this.uiActions.queryValueForAlias(params[StoredValue.ATLAS_ENVIRONMENT_SORT], enumValues(AtlasEnvironmentSortField)) as AtlasEnvironmentSortField || AtlasEnvironmentSortField.ENVIRONMENT;
      this.environmentSortDirection = sortDirectionFromParam(params[StoredValue.ATLAS_ENVIRONMENT_SORT_ORDER], ASCENDING);
    }));
    this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  trackCluster = (_index: number, row: AtlasClusterRow) => row.host || row.name;
  trackEnvironment = (_index: number, row: AtlasClusterEnvironmentRow) => row.environment;

  selectTab(tab: EnvironmentAtlasTab): void {
    this.activeTab = tab;
    void this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {[StoredValue.TAB]: tab, [StoredValue.SUB_TAB]: null},
      queryParamsHandling: "merge"
    });
  }

  clusterConsoleLinks(row: AtlasClusterRow) {
    return this.atlasRowLinks({
      projectId: row.projectId || "",
      clusterName: row.inProvisioningProject ? row.name : "",
      database: ""
    });
  }

  environmentConsoleLinks(row: AtlasClusterEnvironmentRow) {
    return this.atlasRowLinks({
      projectId: row.projectId || "",
      clusterName: row.clusterName || "",
      database: row.database || ""
    });
  }

  private atlasRowLinks(identifiers: {projectId: string; clusterName: string; database: string}) {
    return resolveConsoleUrls(MONGODB_ATLAS_CONSOLE_URLS, identifiers).filter(link =>
      link.iconKey === ConsoleAccessUrlIconKey.DASHBOARD || link.iconKey === ConsoleAccessUrlIconKey.DATABASE);
  }

  async load() {
    this.loading = true;
    this.errorMessage = null;
    const cached = this.view ? null : this.environmentSetupService.cachedAtlasClusters();
    if (cached) {
      this.applyView(cached);
    }
    try {
      this.applyView(await this.environmentSetupService.atlasClusters());
    } catch (error) {
      this.errorMessage = error?.error?.error || error?.message || "Could not load Atlas clusters";
      this.logger.error("load", error);
    } finally {
      this.loading = false;
    }
  }

  private applyView(view: AtlasClusterView) {
    this.view = view;
    this.projectId = view.projectId || "";
    this.defaultCluster = view.defaultCluster || "";
    this.createRequest.name = nextSharedSitesClusterName(view.clusters.map(cluster => cluster.name));
    this.syncDefaultClusterSelect();
  }

  async saveProvisioning() {
    this.saving = true;
    try {
      const saved = await this.environmentSetupService.saveAtlasProvisioning({
        projectId: this.projectId.trim(),
        defaultCluster: this.defaultCluster.trim()
      });
      this.projectId = saved.atlas.projectId || "";
      this.defaultCluster = saved.atlas.defaultCluster || "";
      this.syncDefaultClusterSelect();
      this.notify.success({title: "Saved", message: "Atlas project and default cluster have been saved."});
      await this.load();
    } catch (error) {
      this.notify.error({title: "Could not save", message: error?.error?.error || error?.message || "Save failed"});
    } finally {
      this.saving = false;
    }
  }

  defaultClusterChanged(cluster: MongoClusterInfo | null): void {
    this.selectedDefaultCluster = cluster;
    this.defaultCluster = cluster?.cluster || "";
  }

  private syncDefaultClusterSelect(): void {
    const fromView = (this.view?.clusters || [])
      .filter(row => row.host)
      .map(row => this.clusterInfoFromRow(row));
    this.defaultClusterChoices = this.defaultCluster && !fromView.some(item => item.cluster === this.defaultCluster)
      ? [this.clusterInfoFromHost(this.defaultCluster), ...fromView]
      : fromView;
    this.selectedDefaultCluster = this.defaultClusterChoices.find(item => item.cluster === this.defaultCluster) || null;
  }

  private clusterInfoFromRow(row: AtlasClusterRow): MongoClusterInfo {
    return this.clusterInfoFromHost(row.host, row.environmentNames ? row.environmentNames.split(", ").filter(Boolean) : []);
  }

  private clusterInfoFromHost(host: string, environments: string[] = []): MongoClusterInfo {
    return {cluster: host, username: "", password: "", databases: [], environments};
  }

  async setDefaultCluster(host: string) {
    this.defaultCluster = host;
    this.syncDefaultClusterSelect();
    await this.saveProvisioning();
  }

  clustersNeedingAttention(): AtlasClusterRow[] {
    return (this.view?.clusters || []).filter(cluster => connectionsNearLimit(cluster) || openAtlasAlerts(cluster).length > 0);
  }

  attentionSummary(cluster: AtlasClusterRow): string {
    const percent = connectionPercent(cluster);
    const connections = percent !== null ? `busiest minute in the last 24 hours used ${percent}% of its ${ATLAS_CONNECTION_LIMIT[cluster.instanceSize]} connections` : "";
    const alerts = openAtlasAlerts(cluster).map(atlasAlertLabel);
    const open = alerts.length ? `open Atlas alert: ${alerts.join(", ")}` : "";
    return `${cluster.name}: ${[connections, open].filter(part => !!part).join("; ")}`;
  }

  alertSummary(alert: AtlasClusterAlert): string {
    const raised = this.dateUtils.displayDateAndTime(Date.parse(alert.created));
    const state = alert.status === AtlasAlertStatus.CLOSED ? `resolved${alert.resolved ? ` ${this.dateUtils.displayTime(Date.parse(alert.resolved))}` : ""}` : "still open";
    return `Atlas alert: ${atlasAlertLabel(alert)}, ${raised}, ${state}`;
  }

  fullnessBarClass(level: ClusterFullnessLevel): string {
    if (level === ClusterFullnessLevel.FULL) {
      return "progress-bar bg-danger";
    } else if (level === ClusterFullnessLevel.FILLING) {
      return "progress-bar bg-warning";
    } else {
      return "progress-bar bg-success";
    }
  }

  startDelete(row: AtlasClusterRow) {
    this.deleteTarget = row;
    this.deleteConfirmation = "";
    this.showDeleteConfirmation();
  }

  cancelDelete() {
    this.deleteTarget = null;
    this.deleteConfirmation = "";
  }

  ghostDescription(row: AtlasClusterRow, ghost: AtlasGhostDatabase): string {
    const when = ghost.movedAt ? ` on ${this.dateUtils.displayDate(Date.parse(ghost.movedAt))}` : "";
    const size = ghost.collections !== null ? `, ${ghost.collections} collections` : "";
    const logins = ghostDatabaseLogins(row, ghost).length;
    const keys = logins ? ` It also has ${logins} unused login${logins === 1 ? "" : "s"}, shown as ${logins === 1 ? "a key" : "keys"}, removed with it.` : "";
    return `Database ${ghost.database}${size}: the copy ${ghost.environment} left behind when it moved to ${ghost.movedTo}${when}. No site uses it.${keys}`;
  }

  protected readonly ghostDatabaseLogins = ghostDatabaseLogins;
  protected readonly spareLoginGroups = spareLoginGroups;

  spareLoginsDescription(group: AtlasLeftoverLoginGroup): string {
    const count = group.logins.length;
    return `${count} unused database login${count === 1 ? "" : "s"} for ${group.environment}: ${group.logins.map(login => login.username).join(", ")}. No site or move in progress uses ${count === 1 ? "it" : "them"}, so ${count === 1 ? "it" : "they"} can be deleted.`;
  }

  cleanupSelected(item: AtlasCleanupItem): boolean {
    return this.cleanupSelection.some(selected => selected.key === item.key);
  }

  toggleCleanup(item: AtlasCleanupItem) {
    const wasEmpty = this.cleanupSelection.length === 0;
    this.cleanupSelection = this.cleanupSelected(item)
      ? this.cleanupSelection.filter(selected => selected.key !== item.key)
      : [...this.cleanupSelection, item];
    if (wasEmpty && this.cleanupSelection.length > 0) {
      this.showDeleteConfirmation();
    }
  }

  cleanupConfirmed(): boolean {
    return !cleanupNeedsTypedConfirmation(this.cleanupSelection) || this.cleanupConfirmation.trim().toLowerCase() === ATLAS_CLEANUP_CONFIRMATION_WORD;
  }

  clearCleanup() {
    this.cleanupSelection = [];
    this.cleanupConfirmation = "";
    this.cleanupProgress = "";
    this.cleanupCurrentKey = null;
  }

  private async attempt(label: string, work: () => Promise<{message: string}>): Promise<AtlasCleanupAttempt> {
    try {
      return {succeeded: true, message: (await work()).message};
    } catch (error) {
      return {succeeded: false, message: `${label}: ${error?.error?.error || error?.message || "Delete failed"}`};
    }
  }

  private async cleanupOne(item: AtlasCleanupItem): Promise<AtlasCleanupOutcome> {
    const attempts = item.kind === AtlasCleanupKind.DATABASE
      ? [await this.attempt(item.label, () => this.environmentSetupService.deleteGhostDatabase({migrationId: item.ghost.migrationId, confirmDatabase: item.ghost.database}))]
      : await item.logins.reduce(async (previous: Promise<AtlasCleanupAttempt[]>, login: AtlasLeftoverLogin) =>
        [...await previous, await this.attempt(login.username, () => this.environmentSetupService.deleteLeftoverLogin({projectId: login.projectId, username: login.username}))], Promise.resolve([]));
    const succeeded = attempts.every(attempt => attempt.succeeded);
    return {item, succeeded, message: attempts.filter(attempt => succeeded || !attempt.succeeded).map(attempt => attempt.message).join(" ")};
  }

  async runCleanup() {
    const items = this.cleanupSelection;
    this.cleaningUp = true;
    const outcomes = await items.reduce(async (previous: Promise<AtlasCleanupOutcome[]>, item: AtlasCleanupItem, index: number) => {
      const done = await previous;
      this.cleanupCurrentKey = item.key;
      this.cleanupProgress = `Deleting ${index + 1} of ${items.length}`;
      return [...done, await this.cleanupOne(item)];
    }, Promise.resolve([] as AtlasCleanupOutcome[]));
    const failed = outcomes.filter(outcome => !outcome.succeeded);
    const succeeded = outcomes.filter(outcome => outcome.succeeded);
    if (succeeded.length) {
      this.notify.success({title: `Deleted ${cleanupSelectionSummary(succeeded.map(outcome => outcome.item))}`, message: succeeded.map(outcome => outcome.message).join(" ")});
    }
    if (failed.length) {
      this.notify.error({title: `Could not delete ${cleanupSelectionSummary(failed.map(outcome => outcome.item))}`, message: failed.map(outcome => outcome.message).join(" ")});
    }
    this.cleaningUp = false;
    this.clearCleanup();
    await this.load();
  }

  private showDeleteConfirmation() {
    setTimeout(() => this.host.nativeElement.querySelector(".atlas-delete-confirmation")?.scrollIntoView({behavior: "smooth", block: "start"}));
  }

  async deleteCluster() {
    this.deleting = true;
    try {
      const result = await this.environmentSetupService.deleteAtlasCluster({projectId: this.deleteTarget.projectId, name: this.deleteTarget.name});
      this.notify.success({title: "Cluster deleted", message: result.message});
      this.cancelDelete();
      await this.load();
    } catch (error) {
      this.notify.error({title: "Could not delete cluster", message: error?.error?.error || error?.message || "Delete failed"});
    } finally {
      this.deleting = false;
    }
  }

  tierChanged(tier: AtlasClusterTier) {
    if (isSharedTier(tier)) {
      this.createRequest.region = AwsRegion.EU_WEST_1;
    }
    this.createRequest.separateProject = tier === AtlasClusterTier.M0;
  }

  async createCluster() {
    this.creating = true;
    try {
      const result = await this.environmentSetupService.createAtlasCluster({
        ...this.createRequest,
        name: this.createRequest.name.trim(),
        region: this.createRequest.region
      });
      this.notify.success({title: "Cluster requested", message: result.message});
      await this.load();
    } catch (error) {
      this.notify.error({title: "Could not create cluster", message: error?.error?.error || error?.message || "Create failed"});
    } finally {
      this.creating = false;
    }
  }

  async allowNetwork() {
    try {
      const result = await this.environmentSetupService.allowAtlasNetworkAccess();
      this.notify.success({title: "Network access", message: result.message});
      await this.load();
    } catch (error) {
      this.notify.error({title: "Could not update network access", message: error?.error?.error || error?.message || "Update failed"});
    }
  }

  networkAccessSummary(): string {
    return (this.view?.networkAccess || []).map(entry => entry.cidr + (entry.comment ? ` (${entry.comment})` : "")).join(", ");
  }

  clusterSortChanged(state: SortableTableSortState) {
    this.clusterSortKey = (state.key as AtlasClusterSortField) || AtlasClusterSortField.NAME;
    this.clusterSortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    this.updateQueryParams();
  }

  environmentSortChanged(state: SortableTableSortState) {
    this.environmentSortKey = (state.key as AtlasEnvironmentSortField) || AtlasEnvironmentSortField.ENVIRONMENT;
    this.environmentSortDirection = state.direction === DESCENDING ? DESCENDING : ASCENDING;
    this.updateQueryParams();
  }

  private updateQueryParams() {
    void this.uiActions.updateQueryParameters({
      [StoredValue.ATLAS_CLUSTER_SORT]: this.uiActions.queryValueAliasFor(this.clusterSortKey),
      [StoredValue.ATLAS_CLUSTER_SORT_ORDER]: sortDirectionParam(this.clusterSortDirection),
      [StoredValue.ATLAS_ENVIRONMENT_SORT]: this.uiActions.queryValueAliasFor(this.environmentSortKey),
      [StoredValue.ATLAS_ENVIRONMENT_SORT_ORDER]: sortDirectionParam(this.environmentSortDirection)
    });
  }
}
