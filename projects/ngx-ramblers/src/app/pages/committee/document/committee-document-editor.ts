import {booleanAttribute, Component, ElementRef, EventEmitter, inject, Input, Output, signal, ViewChild} from "@angular/core";
import {firstValueFrom} from "rxjs";
import {FontAwesomeModule} from "@fortawesome/angular-fontawesome";
import {faCircleExclamation, faEye, faFileWord, faPencil, faPrint} from "@fortawesome/free-solid-svg-icons";
import {NgxLoggerLevel} from "ngx-logger";
import {CommitteeDocumentLayout, committeeDocumentPageSize, CommitteeFile} from "../../../models/committee.model";
import {UIDateFormat} from "../../../models/date-format.model";
import {downloadBlob} from "../../../functions/file-download";
import {TiptapMarkdownEditor} from "../../../modules/common/tiptap-editor/tiptap-markdown-editor";
import {StickyControlsDirective} from "../../../modules/common/tiptap-editor/sticky-controls.directive";
import {DocumentExportService} from "../../../services/committee/document-export.service";
import {DocumentPrintService} from "../../../services/document-print.service";
import {DateUtilsService} from "../../../services/date-utils.service";
import {LoggerFactory} from "../../../services/logger-factory.service";
import {toKebabCase} from "../../../functions/strings";
import {CommitteeDocumentView} from "./committee-document-view";

@Component({
  selector: "app-committee-document-editor",
  host: {"data-sticky-offset-root": ""},
  imports: [FontAwesomeModule, TiptapMarkdownEditor, StickyControlsDirective, CommitteeDocumentView],
  styles: [`
    :host
      display: block
      position: relative
      z-index: 0
  `],
  template: `
    <div appStickyControls class="committee-file-editor-actions d-print-none">
      <div class="d-flex gap-2 align-items-center flex-nowrap">
        <ng-content/>
        @if (editable) {
          <button type="button" class="btn btn-quiet" [disabled]="disabled || printing() || exporting()" (click)="togglePreview()">
            <fa-icon [icon]="previewing ? faPencil : faEye" class="me-2"/>
            {{ previewing ? 'Edit document' : 'Preview document / PDF' }}
          </button>
        }
        @if (!editable || previewing) {
          <button type="button" class="btn btn-primary" [disabled]="disabled || printing() || exporting()" (click)="print()">
            <fa-icon [icon]="faPrint" class="me-2"/>
            {{ printing() ? 'Preparing print…' : 'Print / Save as PDF' }}
          </button>
          <button type="button" class="btn btn-quiet" [disabled]="disabled || printing() || exporting()" (click)="downloadWord()">
            <fa-icon [icon]="faFileWord" class="me-2"/>
            {{ exporting() ? 'Preparing Word…' : 'Download Word' }}
          </button>
        }
      </div>
    </div>
    @if (printFailed()) {
      <div class="alert alert-danger d-flex align-items-start gap-2 mt-3">
        <fa-icon [icon]="faCircleExclamation"/>
        <div><strong class="d-block">Could not print the document</strong>Please try printing again.</div>
      </div>
    }
    @if (exportFailed()) {
      <div class="alert alert-danger d-flex align-items-start gap-2 mt-3">
        <fa-icon [icon]="faCircleExclamation"/>
        <div><strong class="d-block">Could not create the Word document</strong>Please try downloading again.</div>
      </div>
    }
    @if (editable && !previewing) {
      <div class="committee-document-editing mb-4">
        <app-tiptap-markdown-editor showPageBreak [eventImageHeight]="imageHeight" (eventImageHeightChange)="imageHeightChange.emit($event)" [value]="value ?? committeeFile?.document?.markdown ?? ''"
                                   placeholder="Write your document here…" (valueChange)="valueChange.emit($event)"/>
      </div>
    }
    <div #documentPreview>
      <app-committee-document-view [committeeFile]="committeeFile" [layout]="resolvedLayout()" [style.--document-image-height.px]="imageHeight"/>
    </div>
  `
})
export class CommitteeDocumentEditor {
  private printer = inject(DocumentPrintService);
  private exporter = inject(DocumentExportService);
  private dates = inject(DateUtilsService);
  private logger = inject(LoggerFactory).createLogger("CommitteeDocumentEditor", NgxLoggerLevel.ERROR);
  @Input() committeeFile: CommitteeFile;
  @Input() imageHeight = 240;
  @Output() imageHeightChange = new EventEmitter<number>();
  @Input() value: string | null = null;
  @Input() layout: CommitteeDocumentLayout | null = null;
  @Input({transform: booleanAttribute}) editable = true;
  @Input({transform: booleanAttribute}) disabled = false;
  @Input({transform: booleanAttribute}) previewing = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() previewingChange = new EventEmitter<boolean>();
  @ViewChild("documentPreview") private documentPreview: ElementRef<HTMLElement>;
  protected printing = signal(false);
  protected printFailed = signal(false);
  protected exporting = signal(false);
  protected exportFailed = signal(false);
  protected readonly faEye = faEye;
  protected readonly faPencil = faPencil;
  protected readonly faPrint = faPrint;
  protected readonly faFileWord = faFileWord;
  protected readonly faCircleExclamation = faCircleExclamation;

  protected resolvedLayout(): CommitteeDocumentLayout {
    return this.layout || this.committeeFile?.document?.layout || CommitteeDocumentLayout.A4_PORTRAIT;
  }

  protected togglePreview(): void {
    this.previewing = !this.previewing;
    this.previewingChange.emit(this.previewing);
  }

  async print(): Promise<void> {
    if (this.documentPreview && !this.printing()) {
      this.printing.set(true);
      this.printFailed.set(false);
      try {
        await this.printer.print(this.documentPreview.nativeElement, this.committeeFile?.document?.title || this.committeeFile?.fileType || "Document", committeeDocumentPageSize(this.resolvedLayout()));
      } catch (error) {
        this.logger.error("Document printing failed", error);
        this.printFailed.set(true);
      } finally {
        this.printing.set(false);
      }
    }
  }

  async downloadWord(): Promise<void> {
    if (!this.exporting()) {
      this.exporting.set(true);
      this.exportFailed.set(false);
      try {
        const title = this.committeeFile?.document?.title || this.committeeFile?.fileType || "Document";
        const blob = await firstValueFrom(this.exporter.docx({
          title,
          markdown: this.value ?? (this.committeeFile?.document?.markdown || ""),
          imageHeight: this.imageHeight,
          layout: this.resolvedLayout()
        }));
        const stamp = this.dates.asString(this.dates.dateTimeNow().toMillis(), undefined, UIDateFormat.FILE_TIMESTAMP_COMPACT);
        downloadBlob(blob, `${toKebabCase(title)}-${stamp}.docx`);
      } catch (error) {
        this.logger.error("Word export failed", error);
        this.exportFailed.set(true);
      } finally {
        this.exporting.set(false);
      }
    }
  }
}
