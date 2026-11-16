import { Component, inject, NgZone, OnDestroy, OnInit, Renderer2, ViewChild } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import { faArrowLeft, faDownload, faFileLines, faUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { CommitteeFile } from "../../../models/committee.model";
import { StoredValue } from "../../../models/ui-actions.model";
import { CommitteeFileService } from "../../../services/committee/committee-file.service";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { MemberLoginService } from "../../../services/member/member-login.service";
import { CommitteeDisplayService } from "../committee-display.service";
import { CommitteeReferenceData } from "../../../services/committee/committee-reference-data";
import { CommitteeDocumentEditor } from "./committee-document-editor";
import { PageComponent } from "../../../page/page.component";
import { AlertPanelComponent } from "../../../modules/common/alert-panel/alert-panel";
import { VideoMeetingsService } from "../../../services/video-meetings/video-meetings.service";
import { MEETING_MINUTES_TEMPLATE_ID } from "../../../models/video-meeting.model";
import { ThumbnailHeadingFrameComponent } from "../../../modules/common/thumbnail-heading-frame/thumbnail-heading-frame";

const PRINT_MODE_BODY_CLASS = "committee-document-print-mode";

@Component({
  selector: "app-committee-document-page",
  template: `
    <app-page includeLastSegment [pageTitle]="pageTitle()">
      @if (committeeFile && allowViewing) {
        @if (display.isComposedDocument(committeeFile)) {
          <app-committee-document-editor [committeeFile]="committeeFile" [editable]="false">
            <button type="button" class="btn btn-secondary" (click)="navigateBack()">
              <fa-icon [icon]="faArrowLeft" class="me-1"/>
              Back
            </button>
          </app-committee-document-editor>
          @if (hasCallTranscript) {
            <div class="mt-4 d-print-none">
              <button type="button" class="btn btn-quiet mb-3" (click)="toggleTranscript()">
                <fa-icon [icon]="faFileLines" class="me-2"/>
                {{ showTranscript ? "Hide call transcript" : "Show call transcript" }}
              </button>
              @if (showTranscript) {
                <app-thumbnail-heading-frame heading="Call transcript">
                  @if (transcriptLoading) {
                    <p>Loading…</p>
                  } @else if (transcript) {
                    <pre class="committee-call-transcript mb-0">{{ transcript }}</pre>
                  } @else {
                    <p class="text-muted mb-0">Nothing was recorded for this meeting.</p>
                  }
                </app-thumbnail-heading-frame>
              }
            </div>
          }
        } @else {
          <div class="d-flex justify-content-between gap-2 mb-3">
            <button type="button" class="btn btn-secondary btn-sm" (click)="navigateBack()">
              <fa-icon [icon]="faArrowLeft" class="me-1"/>
              Back
            </button>
            <a class="btn btn-sunset btn-sm" target="_blank" rel="noopener"
               [href]="display.fileUrl(committeeFile)">
              <fa-icon [icon]="faDownload" class="me-1"/>
              Download
            </a>
          </div>
          @if (embedUrl) {
            @if (mobileViewport && display.isOfficeViewable(committeeFile)) {
              <p>This document is best viewed full screen on a phone.</p>
              <a class="btn btn-primary" target="_blank" rel="noopener"
                 [href]="display.directViewUrl(committeeFile)">
                <fa-icon [icon]="faUpRightFromSquare" class="me-1"/>
                View document
              </a>
            } @else {
              <iframe class="committee-document-embed" [src]="embedUrl"
                      [title]="pageTitle()"></iframe>
            }
          } @else {
            <app-alert-panel title="Preview not available">
              This file type cannot be shown in the browser - use the Download button above to open it.
            </app-alert-panel>
          }
        }
      } @else if (notFound) {
        <app-alert-panel title="Document not available">
          This document does not exist or you do not have access to view it.
        </app-alert-panel>
      }
    </app-page>`,
  imports: [PageComponent, CommitteeDocumentEditor, FontAwesomeModule, AlertPanelComponent, ThumbnailHeadingFrameComponent],
  styles: [`
    .committee-call-transcript
      white-space: pre-wrap
      font-family: inherit
      font-size: 0.95rem
      line-height: 1.5
  `]
})
export class CommitteeDocumentPage implements OnInit, OnDestroy {

  private logger: Logger = inject(LoggerFactory).createLogger("CommitteeDocumentPage", NgxLoggerLevel.ERROR);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fileLoadSequence = 0;
  private renderer = inject(Renderer2);
  private documentRef = inject(DOCUMENT);
  private sanitizer = inject(DomSanitizer);
  private committeeFileService = inject(CommitteeFileService);
  private memberLoginService = inject(MemberLoginService);
  private videoMeetingsService = inject(VideoMeetingsService);
  display = inject(CommitteeDisplayService);
  private subscriptions: Subscription[] = [];
  private committeeReferenceData: CommitteeReferenceData;
  @ViewChild(CommitteeDocumentEditor) private documentEditor: CommitteeDocumentEditor;
  public committeeFile: CommitteeFile;
  public embedUrl: SafeResourceUrl;
  public allowViewing = false;
  public notFound = false;
  private autoPrintTriggered = false;
  protected mobileViewport = false;
  private zone = inject(NgZone);
  private mobileViewportQuery = window.matchMedia("(max-width: 767.98px)");
  private mobileViewportListener = (event: MediaQueryListEvent) => this.zone.run(() => this.mobileViewport = event.matches);
  public showTranscript = false;
  public transcript = "";
  public transcriptLoading = false;
  protected readonly faDownload = faDownload;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faUpRightFromSquare = faUpRightFromSquare;
  protected readonly faFileLines = faFileLines;

  get hasCallTranscript(): boolean {
    return this.committeeFile?.document?.templateId === MEETING_MINUTES_TEMPLATE_ID
      && !!this.committeeFile?.meeting?.room;
  }

  toggleTranscript(): void {
    this.showTranscript = !this.showTranscript;
    if (this.showTranscript && !this.transcript && !this.transcriptLoading) {
      void this.loadTranscript();
    }
  }

  private async loadTranscript(): Promise<void> {
    const room = this.committeeFile?.meeting?.room;
    if (!room) {
      this.transcript = "";
    } else {
      this.transcriptLoading = true;
      try {
        const response = await this.videoMeetingsService.transcriptForRoom(room);
        this.transcript = response?.transcript || "";
      } catch (error) {
        this.logger.error("failed to load call transcript", room, error);
        this.transcript = "";
      }
      this.transcriptLoading = false;
    }
  }

  ngOnInit(): void {
    this.mobileViewport = this.mobileViewportQuery.matches;
    this.mobileViewportQuery.addEventListener("change", this.mobileViewportListener);
    this.renderer.addClass(this.documentRef.body, PRINT_MODE_BODY_CLASS);
    this.subscriptions.push(this.display.configEvents().subscribe(data => {
      this.committeeReferenceData = data;
      this.refreshVisibility();
    }));
    this.subscriptions.push(this.route.queryParamMap.subscribe(queryParamMap => {
      const documentSlug = queryParamMap.get(StoredValue.DOCUMENT);
      const fileSlug = queryParamMap.get(StoredValue.FILE);
      const slug = documentSlug || fileSlug;
      this.logger.info("loading committee file for slug:", slug, "expectComposed:", !!documentSlug);
      if (slug) {
        this.loadCommitteeFile(slug, !!documentSlug);
      }
    }));
  }

  ngOnDestroy(): void {
    this.mobileViewportQuery.removeEventListener("change", this.mobileViewportListener);
    this.renderer.removeClass(this.documentRef.body, PRINT_MODE_BODY_CLASS);
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  pageTitle(): string {
    return this.committeeFile?.document?.title || this.committeeFile?.fileNameData?.title || this.committeeFile?.fileType;
  }

  private loadCommitteeFile(slug: string, expectComposed: boolean): void {
    const sequence = ++this.fileLoadSequence;
    this.committeeFile = null;
    this.allowViewing = false;
    this.notFound = false;
    this.embedUrl = null;
    this.committeeFileService.all()
      .then(committeeFiles => {
        if (sequence === this.fileLoadSequence) {
          const committeeFile = this.display.committeeFileMatchingSlug(
            committeeFiles.filter(candidate => this.display.isComposedDocument(candidate) === expectComposed), slug);
          if (committeeFile) {
            this.committeeFile = committeeFile;
            this.showTranscript = false;
            this.transcript = "";
            if (!expectComposed && this.display.canViewInBrowser(committeeFile)) {
              this.embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.display.attachmentEmbedUrl(committeeFile));
            }
            this.refreshVisibility();
          } else {
            this.notFound = true;
          }
        }
      })
      .catch(error => {
        this.logger.error("failed to load committee file for slug:", slug, error);
        if (sequence === this.fileLoadSequence) {
          this.notFound = true;
        }
      });
  }

  private refreshVisibility(): void {
    if (this.committeeFile && this.committeeReferenceData) {
      this.allowViewing = this.committeeReferenceData.isPublic(this.committeeFile.fileType)
        || this.memberLoginService.allowCommittee()
        || this.memberLoginService.allowFileAdmin();
      this.notFound = !this.allowViewing;
      if (this.allowViewing && !this.autoPrintTriggered
        && this.display.isComposedDocument(this.committeeFile)
        && this.route.snapshot.queryParamMap.get(StoredValue.PRINT) === "true") {
        this.autoPrintTriggered = true;
        setTimeout(() => this.print(), 500);
      }
    }
  }

  print(): void {
    void this.documentEditor?.print();
  }

  navigateBack(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {[StoredValue.DOCUMENT]: null, [StoredValue.FILE]: null, print: null},
      queryParamsHandling: "merge"
    });
  }
}
