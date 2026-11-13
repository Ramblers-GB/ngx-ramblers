import {NgSelectModule} from "@ng-select/ng-select";
import {Component, inject, Input, OnInit} from "@angular/core";
import {coerceBooleanProperty} from "@angular/cdk/coercion";
import {FormsModule} from "@angular/forms";
import {RouterLink} from "@angular/router";
import {FontAwesomeModule} from "@fortawesome/angular-fontawesome";
import {faGear} from "@fortawesome/free-solid-svg-icons";
import {kebabCase} from "es-toolkit/compat";
import {EmailComposerStepKey, ProgrammeEventFormat, PROGRAMME_EVENT_FORMATS, PROGRAMME_EVENT_TEMPLATE_PATH_PREFIX} from "../../models/email-composer.model";
import {MailSettingsTab} from "../../models/mail.model";
import {StoredValue} from "../../models/ui-actions.model";
import {PageContent} from "../../models/content-text.model";
import {TemplateSelectorComponent} from "../../modules/common/dynamic-content/template-selector";
import {EmailComposerProgrammeService} from "../../services/email-composer/email-composer-programme.service";
import {EmailComposerSessionService} from "../../services/email-composer/email-composer-session.service";

@Component({
  selector: "app-email-composer-programme",
  imports: [NgSelectModule, FormsModule, FontAwesomeModule, RouterLink, TemplateSelectorComponent],
  template: `
    <div [class.thumbnail-heading-frame]="!compact" [class.mt-3]="!compact" [class.mb-3]="compact">
      @if (!compact) {
        <div class="thumbnail-heading">Event listing</div>
        <p>Choose how each event appears in the email and in the printable programme. Open Preview &amp; Review for Email, a printable page grid, and an editable document, with A4, A5 and A5 booklet layouts.</p>
      }
      <div class="row g-3" [class.mb-3]="!compact">
        <div class="col-md-6">
          <label [attr.for]="formatFieldId" class="form-label">Event format</label>
          @if (controlsLive()) {
          <ng-select dropdownPosition="bottom" [clearable]="false" [searchable]="false" appendTo="body" [labelForId]="formatFieldId" [ngModel]="programme.settings().format" (ngModelChange)="onFormatSelected($event)">
            @for (format of formats; track format.value) {
              <ng-option [value]="format.value">{{ format.label }}</ng-option>
            }
          </ng-select>
          }
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <a class="btn btn-quiet" routerLink="/admin/mail-settings" [queryParams]="settingsParams()" target="_blank" rel="noopener">
            <fa-icon [icon]="faGear" class="me-2"/>Manage event templates
          </a>
        </div>
      </div>
      @if (programme.settings().format === ProgrammeEventFormat.CUSTOM) {
        <app-template-selector label="Saved event format" [pathPrefix]="templatePathPrefix"
                               [showActionButtons]="false" [showViewAction]="false" [selectFirstTemplate]="false"
                               [selectedTemplateFragmentId]="programme.settings().templateId || ''" (selectionChanged)="selectTemplate($event)"/>
      }
      @if (!compact) {
        <p class="small text-muted mt-3 mb-0">Save the email draft to keep this format and any edits to the printable document. <a href="javascript:void(0)" (click)="openPreview()">Preview &amp; Review</a> has Email, printable and editable views of the finished content.</p>
      }
    </div>
  `
})
export class EmailComposerProgrammeComponent implements OnInit {
  compact = false;
  protected formatFieldId = "programme-event-format";

  @Input("compact") set compactInput(value: boolean | string) {
    this.compact = coerceBooleanProperty(value);
    this.formatFieldId = this.compact ? "programme-event-format-review" : "programme-event-format";
  }

  protected programme = inject(EmailComposerProgrammeService);
  private session = inject(EmailComposerSessionService);
  protected readonly formats = PROGRAMME_EVENT_FORMATS.map(format => ({...format,
    label: format.value === ProgrammeEventFormat.CUSTOM ? "Saved event template" : format.label}));
  protected readonly templatePathPrefix = PROGRAMME_EVENT_TEMPLATE_PATH_PREFIX;
  protected readonly ProgrammeEventFormat = ProgrammeEventFormat;
  protected readonly faGear = faGear;

  ngOnInit(): void {
    void this.programme.applySavedFormatIfNeeded();
  }

  protected settingsParams(): Record<string, string> {
    return {
      [StoredValue.TAB]: kebabCase(MailSettingsTab.EVENT_TEMPLATES),
      [StoredValue.EVENT_FORMAT]: this.programme.settings().format
    };
  }

  protected controlsLive(): boolean {
    if (this.compact) {
      return this.session.activeStep === EmailComposerStepKey.REVIEW;
    } else {
      return this.session.activeStep === EmailComposerStepKey.EVENTS || this.session.activeStep === EmailComposerStepKey.COMPOSE;
    }
  }

  protected onFormatSelected(format: ProgrammeEventFormat): void {
    if (format) {
      this.programme.settings().format = format;
      void this.programme.selectFormat();
    }
  }

  protected selectTemplate(template: PageContent | null): void {
    if (template) {
      this.programme.applyTemplate(template);
    }
  }

  protected openPreview(): void {
    this.session.requestStep.next(EmailComposerStepKey.REVIEW);
  }
}
