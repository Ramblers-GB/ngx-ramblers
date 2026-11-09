import { Component, inject, Input } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { coerceBooleanProperty } from "@angular/cdk/coercion";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { reversed } from "../../functions/arrays";
import { ansiHtml, stripAnsi } from "../../models/system-log.model";
import { CopyIconComponent } from "../../modules/common/copy-icon/copy-icon";

@Component({
  selector: "app-session-logs",
  imports: [CopyIconComponent, FontAwesomeModule],
  template: `
    <div class="position-relative">
      <div class="session-logs" [class.session-logs-live]="live">
        @if (!messagesNewestFirst().length && waitingMessage) {
          <div>
            <fa-icon [icon]="faSpinner" animation="spin" class="me-1"></fa-icon>{{ waitingMessage }}
          </div>
        }
        @for (message of messagesNewestFirst(); track $index) {
          <div class="session-log-line" [innerHTML]="colouredMessage(message)"></div>
        }
      </div>
      <div class="session-logs-copy">
        <app-copy-icon [value]="sessionLogsText()" elementName="session logs"/>
      </div>
    </div>
  `,
  styles: [`
    .session-logs
      background-color: #1e293b
      color: #e2e8f0
      padding: 1rem
      border-radius: 0.375rem
      font-family: monospace
      font-size: 0.875rem
      max-height: 400px
      max-width: 100%
      overflow-y: auto
      overflow-x: hidden
      white-space: pre-wrap
      word-break: break-word
      overflow-wrap: anywhere

      &.session-logs-live
        min-height: 400px

      div
        margin-bottom: 0.25rem
        white-space: pre-wrap
        word-break: break-word
        overflow-wrap: anywhere

    .session-log-line
      animation: session-log-line-appear 400ms ease-out

    @keyframes session-log-line-appear
      0%
        opacity: 0
      100%
        opacity: 1

    .session-logs-copy
      position: absolute
      top: 0.5rem
      right: 1.25rem
      color: #e2e8f0
      font-size: 1.1rem

      &:hover
        color: #ffffff
  `]
})
export class SessionLogsComponent {
  @Input() messages: string[] = [];
  @Input() waitingMessage: string | null = null;
  private sanitizer = inject(DomSanitizer);
  protected readonly faSpinner = faSpinner;
  protected live = false;

  @Input("live") set liveInput(value: boolean | string) {
    this.live = coerceBooleanProperty(value);
  }

  messagesNewestFirst(): string[] {
    return reversed(this.messages);
  }

  sessionLogsText(): string {
    return this.messagesNewestFirst().map(message => stripAnsi(message)).join("\n");
  }

  colouredMessage(message: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(ansiHtml(message));
  }
}
