import { Component, EventEmitter, inject, Input, OnChanges, Output, signal } from "@angular/core";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation, faRoute } from "@fortawesome/free-solid-svg-icons";
import { FileNameData } from "../../../models/aws-object.model";
import { LocationDetails } from "../../../models/ramblers-walks-manager.model";
import { ROUTE_START_COPY_NOTE, RouteStartAlignment } from "../../../models/route-follow.model";
import { routeStartAdjustable, routeStartAlignment, routeStartAlignmentMessage, routeStartNeedsAttention, walkStartPoint } from "../../../functions/route-start-alignment";
import { RouteFollowPayloadService } from "../../../services/maps/route-follow-payload.service";
import { RouteFollowService } from "../../../services/maps/route-follow.service";

@Component({
  selector: "app-walk-route-start-check",
  imports: [FontAwesomeModule],
  template: `
    @if (needsAttention) {
      <div class="alert alert-warning d-flex align-items-start gap-2 mt-2 mb-0" role="status">
        <fa-icon class="mt-1" [icon]="faCircleExclamation"/>
        <div>
          <strong class="d-block">Route does not start at the walk's start</strong>
          {{ message }}
          @if (adjustable) {
            <div class="small mt-1">Open the route editor to adjust it. {{ ROUTE_START_COPY_NOTE }}</div>
            <button type="button" class="btn btn-sm btn-primary mt-2" [disabled]="disabled" (click)="adjust.emit()">
              <fa-icon class="me-2" [icon]="faRoute"/>Adjust the route
            </button>
          }
        </div>
      </div>
    }
  `
})
export class WalkRouteStartCheckComponent implements OnChanges {
  private payloadService = inject(RouteFollowPayloadService);
  private followService = inject(RouteFollowService);
  @Input() gpxFile: FileNameData | null = null;
  @Input() startLocation: LocationDetails | null = null;
  @Input() awsFileName: string | null = null;
  @Input() latitude: number | null = null;
  @Input() longitude: number | null = null;
  @Input() disabled = false;
  @Output() adjust = new EventEmitter<void>();
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faRoute = faRoute;
  protected readonly ROUTE_START_COPY_NOTE = ROUTE_START_COPY_NOTE;
  protected alignment = signal<RouteStartAlignment | null>(null);
  private checkSequence = 0;

  ngOnChanges(): void {
    void this.check();
  }

  get needsAttention(): boolean {
    return routeStartNeedsAttention(this.alignment());
  }

  get adjustable(): boolean {
    return routeStartAdjustable(this.alignment());
  }

  get message(): string {
    const name = this.startLocation?.description || this.startLocation?.postcode || "the walk's start";
    return this.alignment() ? routeStartAlignmentMessage(this.alignment(), name, metres => this.followService.formatDistance(metres)) : "";
  }

  private async check(): Promise<void> {
    const sequence = ++this.checkSequence;
    const start = walkStartPoint(this.startLocation);
    const points = this.gpxFile?.awsFileName && start ? await this.payloadService.routePoints(this.gpxFile) : [];
    if (sequence === this.checkSequence) {
      this.alignment.set(routeStartAlignment(points, start));
    }
  }
}
