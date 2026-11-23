import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircle, faPersonWalking } from "@fortawesome/free-solid-svg-icons";
import { TooltipModule } from "ngx-bootstrap/tooltip";
import { Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { AppPath, RouteFollowReturn } from "../../models/route-follow.model";
import { AppShellService } from "../../services/maps/app-shell.service";
import { RouteRecordingReturnService } from "../../services/maps/route-recording-return.service";

@Component({
  selector: "app-recording-return-button",
  imports: [FontAwesomeModule, TooltipModule],
  template: `
    @if (returnTo && !onFollowScreen) {
      <button type="button" class="btn btn-primary btn-icon app-floating-navigation recording-return"
              (click)="returnTooltip.hide(); backToRoute()"
              [attr.aria-label]="label()" [tooltip]="label()" [isDisabled]="!appShell.tooltipsEnabled()" #returnTooltip="bs-tooltip">
        @if (returnTo.recording) {
          <fa-icon [icon]="faCircle" class="recording-return-dot"/>
        } @else {
          <fa-icon [icon]="faPersonWalking"/>
        }
      </button>
    }
  `,
  styles: [`
    .recording-return
      left: 50%
      transform: translateX(-50%)

    .recording-return-dot
      color: #C60C30
      animation: recording-return-pulse 1.6s ease-in-out infinite

    @keyframes recording-return-pulse
      0%, 100%
        opacity: 1
        transform: scale(1)
      50%
        opacity: 0.5
        transform: scale(0.8)

    @media (prefers-reduced-motion: reduce)
      .recording-return-dot
        animation: none
  `]
})
export class RecordingReturnButtonComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private recordingReturn = inject(RouteRecordingReturnService);
  protected appShell = inject(AppShellService);
  private subscriptions: Subscription[] = [];
  protected readonly faCircle = faCircle;
  protected readonly faPersonWalking = faPersonWalking;
  protected returnTo: RouteFollowReturn | null = null;
  protected onFollowScreen = false;

  ngOnInit(): void {
    this.subscriptions.push(this.recordingReturn.return$.subscribe(returnTo => this.returnTo = returnTo));
    this.refreshLocation();
    this.subscriptions.push(this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => this.refreshLocation()));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  protected label(): string {
    return this.returnTo?.recording ? "Back to recording" : "Back to your walk";
  }

  protected backToRoute(): void {
    if (this.returnTo) {
      void this.router.navigateByUrl(this.returnTo.url);
    }
  }

  private refreshLocation(): void {
    const path = this.router.url.split("?")[0];
    const followPath = "/" + AppPath.ROOT + "/" + AppPath.ROUTE;
    this.onFollowScreen = path === followPath || path.startsWith(followPath + "/");
    if (!this.onFollowScreen) {
      this.recordingReturn.offerSavedSession();
    }
  }
}
