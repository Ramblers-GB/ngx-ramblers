import {Component, inject, OnInit} from "@angular/core";
import {FormsModule} from "@angular/forms";
import {FontAwesomeModule} from "@fortawesome/angular-fontawesome";
import {faCircleCheck, faCircleExclamation, faSave} from "@fortawesome/free-solid-svg-icons";
import {filter, firstValueFrom} from "rxjs";
import {DocumentAppearance, documentAppearance} from "../../../../models/document-appearance.model";
import {CommitteeFile} from "../../../../models/committee.model";
import {Image} from "../../../../models/system.model";
import {SystemConfigService} from "../../../../services/system/system-config.service";
import {TiptapMarkdownEditor} from "../../../../modules/common/tiptap-editor/tiptap-markdown-editor";
import {CommitteeDocumentView} from "../../../committee/document/committee-document-view";

@Component({
  selector: "app-document-appearance-settings",
  imports: [FormsModule, FontAwesomeModule, TiptapMarkdownEditor, CommitteeDocumentView],
  template: `
    <div class="thumbnail-heading-frame">
      <div class="thumbnail-heading">Document letterhead and footer</div>
      <p>These settings apply to document previews, printed PDFs and Word downloads, including committee documents and composer programmes. Email branding is configured separately.</p>
      @if (ready) {
        <div class="thumbnail-heading-frame thumbnail-heading-frame-compact">
          <div class="thumbnail-heading">Letterhead</div>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showLetterhead" (ngModelChange)="refreshPreview()"><span class="form-check-label">Show letterhead</span></label>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showLogo" (ngModelChange)="refreshPreview()"><span class="form-check-label">Show the group logo on the letterhead</span></label>
          <label for="document-header-image" class="form-label">Letterhead background</label>
          <select id="document-header-image" class="form-select mb-2" [(ngModel)]="appearance.headerImage" (ngModelChange)="refreshPreview()">
            <option [ngValue]="null">Ramblers papercut</option>
            @for (image of backgrounds; track image.awsFileName) {<option [ngValue]="image.awsFileName">{{ image.originalFileName }}</option>}
          </select>
          <p class="text-muted small">Uses the logo and background images already configured in System settings. Backgrounds fill the letterhead band.</p>
        </div>
        <div class="thumbnail-heading-frame thumbnail-heading-frame-compact">
          <div class="thumbnail-heading">Footer</div>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showGroupName" (ngModelChange)="refreshPreview()"><span class="form-check-label">Group name</span></label>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showContactEmail" (ngModelChange)="refreshPreview()"><span class="form-check-label">Contact email</span></label>
          <label for="document-contact-email" class="form-label">Contact email override</label>
          <input id="document-contact-email" type="email" #contactEmail="ngModel" class="form-control mb-2" [(ngModel)]="appearance.contactEmail" (ngModelChange)="refreshPreview()" placeholder="Leave empty to use the group's contact email">
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showWebsite" (ngModelChange)="refreshPreview()"><span class="form-check-label">Group website</span></label>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showLegal" (ngModelChange)="refreshPreview()"><span class="form-check-label">Charity and registered office details</span></label>
          <label class="form-check"><input type="checkbox" class="form-check-input" [(ngModel)]="appearance.showRegulator" (ngModelChange)="refreshPreview()"><span class="form-check-label">Fundraising Regulator logo</span></label>
          <label class="form-label">Additional footer text</label>
          <app-tiptap-markdown-editor [value]="appearance.footerMarkdown" (valueChange)="appearance.footerMarkdown = $event; refreshPreview()"/>
        </div>
        <button type="button" class="btn btn-primary my-3" [disabled]="saving || contactEmail.invalid" (click)="save()"><fa-icon [icon]="faSave" class="me-2"/>{{ saving ? 'Saving…' : 'Save document appearance' }}</button>
        @if (message) {
          <div class="alert d-flex align-items-start gap-2" [class.alert-danger]="failed" [class.alert-success]="!failed">
            <fa-icon [icon]="failed ? faCircleExclamation : faCircleCheck"/>
            <div><strong class="d-block">{{ failed ? 'Could not save document appearance' : 'Document appearance saved' }}</strong>{{ message }}</div>
          </div>
        }
        <div class="thumbnail-heading-frame">
          <div class="thumbnail-heading">Preview</div>
          <app-committee-document-view [committeeFile]="preview" [appearance]="previewAppearance"/>
        </div>
      }
    </div>
  `
})
export class DocumentAppearanceSettingsComponent implements OnInit {
  private system = inject(SystemConfigService);
  protected appearance = documentAppearance(null);
  protected previewAppearance: DocumentAppearance = this.appearance;
  protected backgrounds: Image[] = [];
  protected ready = false;
  protected saving = false;
  protected failed = false;
  protected message = "";
  protected readonly preview: CommitteeFile = {fileType: "Document appearance preview", document: {title: "Programme preview", markdown: "## Document appearance\n\nThis sample shows the letterhead and footer used for your documents."}};
  protected readonly faSave = faSave;
  protected readonly faCircleCheck = faCircleCheck;
  protected readonly faCircleExclamation = faCircleExclamation;

  async ngOnInit(): Promise<void> {
    const config = this.system.systemConfig() || await firstValueFrom(this.system.events().pipe(filter(Boolean)));
    this.appearance = documentAppearance(config.documentAppearance || null);
    this.backgrounds = config.backgrounds?.images || [];
    this.refreshPreview();
    this.ready = true;
  }

  protected refreshPreview(): void {
    this.previewAppearance = {...this.appearance};
  }

  protected async save(): Promise<void> {
    this.saving = true;
    this.message = "";
    try {
      await this.system.saveConfig({...this.system.systemConfig(), documentAppearance: {...this.appearance}});
      this.failed = false;
      this.message = "Document previews and future downloads now use these settings.";
    } catch (error) {
      this.failed = true;
      this.message = error.message;
    } finally {
      this.saving = false;
    }
  }
}
