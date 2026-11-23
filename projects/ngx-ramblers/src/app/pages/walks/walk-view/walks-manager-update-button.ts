import { Component, EventEmitter, inject, Input, OnDestroy, OnInit, Output } from "@angular/core";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faArrowsRotate } from "@fortawesome/free-solid-svg-icons";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import { AuthService } from "../../../auth/auth.service";
import { ExtendedGroupEvent, InputSource } from "../../../models/group-event.model";
import { EventPopulation } from "../../../models/system.model";
import { RamblersEventType } from "../../../models/ramblers-walks-manager.model";
import { MemberLoginService } from "../../../services/member/member-login.service";
import { LoggerFactory } from "../../../services/logger-factory.service";
import { AlertInstance } from "../../../services/notifier.service";
import { SystemConfigService } from "../../../services/system/system-config.service";
import { RamblersWalksAndEventsService } from "../../../services/walks-and-events/ramblers-walks-and-events.service";

@Component({
  selector: "app-walks-manager-update-button",
  imports: [FontAwesomeModule],
  template: `
    @if (eligible() && (updateAvailable || updating)) {
      <button type="button" class="btn btn-quiet walk-view-action" [disabled]="updating"
              title="Replace this website's walk details with the latest version from Walks Manager"
              (click)="updateWalk()">
        <fa-icon [icon]="faArrowsRotate" [animation]="updating ? 'spin' : null"/>
        <span>{{ updating ? 'Updating walk' : 'Update from Walks Manager' }}</span>
      </button>
    }
  `,
  styles: [`
    :host
      display: contents
  `]
})
export class WalksManagerUpdateButton implements OnInit, OnDestroy {
  private memberLoginService = inject(MemberLoginService);
  private systemConfigService = inject(SystemConfigService);
  private authService = inject(AuthService);
  private ramblersService = inject(RamblersWalksAndEventsService);
  private logger = inject(LoggerFactory).createLogger("WalksManagerUpdateButton", NgxLoggerLevel.ERROR);
  private subscriptions: Subscription[] = [];
  private currentWalk: ExtendedGroupEvent;
  private comparisonRequest = 0;
  protected readonly faArrowsRotate = faArrowsRotate;
  public updateAvailable = false;
  public updating = false;
  @Input() notify: AlertInstance;
  @Output() walkUpdated = new EventEmitter<ExtendedGroupEvent>();

  @Input() set walk(walk: ExtendedGroupEvent) {
    this.currentWalk = walk;
    void this.checkForUpdate();
  }

  ngOnInit(): void {
    this.subscriptions.push(this.systemConfigService.events().subscribe(() => void this.checkForUpdate()));
    this.subscriptions.push(this.authService.authResponse().subscribe(() => void this.checkForUpdate()));
  }

  ngOnDestroy(): void {
    this.comparisonRequest++;
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  eligible(): boolean {
    const config = this.systemConfigService.systemConfig();
    return this.memberLoginService.memberLoggedIn() && this.memberLoginService.isAdmin() &&
      config?.group?.walkPopulation === EventPopulation.WALKS_MANAGER &&
      this.currentWalk?.fields?.inputSource === InputSource.WALKS_MANAGER_CACHE &&
      this.currentWalk?.groupEvent?.item_type === RamblersEventType.GROUP_WALK &&
      !!this.currentWalk?.id && !!this.currentWalk?.groupEvent?.id;
  }

  async checkForUpdate(): Promise<void> {
    const request = ++this.comparisonRequest;
    this.updateAvailable = false;
    if (this.eligible()) {
      try {
        const result = await this.ramblersService.checkWalksManagerUpdate(this.currentWalk.id);
        if (request === this.comparisonRequest && this.eligible()) {
          this.updateAvailable = result.changed;
        }
      } catch (error) {
        this.logger.warn("Unable to compare walk with Walks Manager", error);
      }
    }
  }

  async updateWalk(): Promise<void> {
    if (this.eligible() && this.updateAvailable && !this.updating) {
      const walkId = this.currentWalk.id;
      this.updating = true;
      try {
        const result = await this.ramblersService.updateFromWalksManager(walkId);
        if (this.currentWalk?.id === walkId && this.eligible()) {
          this.updateAvailable = false;
          if (result.walk) {
            this.walkUpdated.emit(result.walk);
          }
          this.notify.success({title: result.changed ? "Walk updated" : "Walk already up to date", message: "The website now shows the latest details from Walks Manager."});
        }
      } catch (error) {
        this.logger.error("Unable to update walk from Walks Manager", error);
        this.notify.error({title: "Walk could not be updated", message: "Please try again. If the problem continues, check the Walks Manager connection in System Settings."});
      } finally {
        this.updating = false;
      }
    }
  }
}
