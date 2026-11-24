import { Component, Input } from "@angular/core";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";

@Component({
  selector: "app-event-notice-alert",
  imports: [FontAwesomeModule],
  template: `
    <div class="alert alert-warning mb-2">
      <div class="d-flex align-items-start gap-2">
        <fa-icon class="event-notice-icon" [icon]="faCircleExclamation"/>
        <strong>{{ title }}</strong>
      </div>
      @if (message) {
        <p class="mb-0 mt-1 event-notice-message">{{ message }}</p>
      }
    </div>
  `,
  styles: [`
    .alert
      padding-left: 0.75rem
      padding-right: 0.75rem

    .event-notice-message
      white-space: pre-line
  `]
})
export class EventNoticeAlert {
  @Input() title = "";
  @Input() message: string | null = null;
  protected readonly faCircleExclamation = faCircleExclamation;
}
