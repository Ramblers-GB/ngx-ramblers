import {DocumentAppearance, documentAppearance} from "../../../models/document-appearance.model";
import { AfterViewInit, Component, ElementRef, inject, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import { fromEvent, Subscription } from "rxjs";
import { debounceTime } from "rxjs/operators";
import { MarkdownComponent } from "ngx-markdown";
import { BuiltInRole, CommitteeDocumentLayout, CommitteeFile } from "../../../models/committee.model";
import { ramblersLegalBoilerplate } from "../../../models/ramblers-legal.model";
import { Image, Organisation, SystemConfig } from "../../../models/system.model";
import { bookletSpreads, keepTogetherUnits, KeepUnit, KeepUnitKind, paginateKeepTogether } from "../../../functions/committee-document-pagination";
import { CommitteeConfigService } from "../../../services/committee/commitee-config.service";
import { DateUtilsService } from "../../../services/date-utils.service";
import { Logger, LoggerFactory } from "../../../services/logger-factory.service";
import { SystemConfigService } from "../../../services/system/system-config.service";
import { UrlService } from "../../../services/url.service";
import { stripTrailingSlash } from "../../../functions/strings";
import { encodeMarkdownLinkUrls } from "../../../functions/markdown";

@Component({
  selector: "app-committee-document-view",
  template: `
    <div class="committee-document-backdrop" [class.committee-document-grid]="gridPreview"
         [attr.data-layout]="resolvedLayout()">
      <div class="committee-document-scroll">
        <div class="committee-document-pages" #pagesHost [attr.data-layout]="resolvedLayout()"></div>
      </div>
      <div class="committee-document-measure" #measureHost [attr.data-layout]="resolvedLayout()">
        <div #masterHeader class="committee-document-page-header">
          @if (resolvedAppearance().showLetterhead) {
          <div class="committee-document-band">
            <img class="committee-document-band-image"
                 [src]="headerImage()"
                 alt="">
          </div>
          @if (resolvedAppearance().showLogo) {
          <div class="committee-document-header">
            @if (logo?.awsFileName) {
              <img class="committee-document-logo"
                   [src]="urlService.resourceRelativePathForAWSFileName(logo.awsFileName)"
                   [alt]="group?.shortName">
            } @else {
              <div class="committee-document-group-name">{{ group?.longName || group?.shortName }}</div>
            }
          </div>
          }
          }
        </div>
        <div #masterContent>
          @if (!bodyProvidesTitle()) {
            <div class="committee-document-title-block">
              <h1 class="committee-document-title">
                <span>{{ committeeFile?.document?.title || committeeFile?.fileType }}</span>
              </h1>
              @if (committeeFile?.eventDate) {
                <div class="committee-document-date">{{ formattedEventDate() }}</div>
              }
            </div>
          }
          <div class="committee-document-body">
            <markdown [data]="renderableMarkdown()" (ready)="onMarkdownReady()"/>
          </div>
        </div>
        <div #masterFooter>
          <div class="committee-document-footer">
            <div class="committee-document-footer-row">
              <div>
                @if (resolvedAppearance().showGroupName) {<div class="committee-document-footer-group">{{ group?.longName || group?.shortName }}</div>}
                <div class="committee-document-footer-contact">
                  @if (resolvedAppearance().showContactEmail && footerEmail()) {
                    <a [href]="'mailto:' + footerEmail()">{{ footerEmail() }}</a>
                  }
                  @if (resolvedAppearance().showContactEmail && footerEmail() && resolvedAppearance().showWebsite && group?.href) {
                    <span class="committee-document-footer-separator">|</span>
                  }
                  @if (resolvedAppearance().showWebsite && group?.href) {
                    <a [href]="group.href" target="_blank" rel="noopener">{{ displayHref() }}</a>
                  }
                </div>
                @if (resolvedAppearance().footerMarkdown) {<markdown [data]="resolvedAppearance().footerMarkdown" (ready)="schedulePagination()"/>}
                @if (resolvedAppearance().showLegal) {
                <div class="committee-document-footer-charity">
                  {{ ramblersLegalBoilerplate() }}
                </div>
                }
              </div>
              @if (resolvedAppearance().showRegulator) {
              <img class="committee-document-footer-regulator"
                   src="/assets/images/local/fr-regulator-colour.svg"
                   alt="Registered with Fundraising Regulator">
              }
            </div>
          </div>
        </div>
        <div class="committee-document-sheet committee-document-measure-sheet" #measureSheet [attr.data-layout]="resolvedLayout()">
          <div class="committee-document-body committee-document-page-body" #measureBody></div>
        </div>
      </div>
    </div>`,
  imports: [MarkdownComponent]
})
export class CommitteeDocumentView implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  private logger: Logger = inject(LoggerFactory).createLogger("CommitteeDocumentView", NgxLoggerLevel.ERROR);
  private systemConfigService = inject(SystemConfigService);
  private committeeConfigService = inject(CommitteeConfigService);
  private zone = inject(NgZone);
  protected dateUtils = inject(DateUtilsService);
  urlService = inject(UrlService);
  protected readonly ramblersLegalBoilerplate = ramblersLegalBoilerplate;
  private subscriptions: Subscription[] = [];
  private sourceMarkdown: string | null = null;
  private encodedMarkdown = "";
  private contentBlocks: HTMLElement[] = [];
  private paginationTimer: ReturnType<typeof setTimeout>;
  private paginationGeneration = 0;
  private viewReady = false;
  public group: Organisation;
  public logo: Image;
  public contactEmail: string;
  protected readonly CommitteeDocumentLayout = CommitteeDocumentLayout;

  @Input() committeeFile: CommitteeFile;
  @Input() appearance: DocumentAppearance | null = null;
  private configuredAppearance = documentAppearance(null);
  @Input() layout: CommitteeDocumentLayout | null = null;
  @Input() gridPreview = true;
  @ViewChild("pagesHost") pagesHost: ElementRef<HTMLDivElement>;
  @ViewChild("measureHost") measureHost: ElementRef<HTMLDivElement>;
  @ViewChild("masterHeader") masterHeader: ElementRef<HTMLDivElement>;
  @ViewChild("masterContent") masterContent: ElementRef<HTMLDivElement>;
  @ViewChild("masterFooter") masterFooter: ElementRef<HTMLDivElement>;
  @ViewChild("measureSheet") measureSheet: ElementRef<HTMLDivElement>;
  @ViewChild("measureBody") measureBody: ElementRef<HTMLDivElement>;

  ngOnInit(): void {
    this.subscriptions.push(this.systemConfigService.events().subscribe((systemConfig: SystemConfig) => {
      this.group = systemConfig?.group;
      this.configuredAppearance = documentAppearance(systemConfig?.documentAppearance || null);
      this.logo = systemConfig?.logos?.images?.find(logo => logo.originalFileName === systemConfig?.header?.selectedLogo);
      this.schedulePagination();
    }));
    this.subscriptions.push(this.committeeConfigService.committeeReferenceDataEvents().subscribe(committeeReferenceData => {
      this.contactEmail = committeeReferenceData?.contactUsFieldForBuiltInRole(BuiltInRole.CONTACT_US, "email");
      this.schedulePagination();
    }));
    this.zone.runOutsideAngular(() => {
      this.subscriptions.push(fromEvent(window, "resize").pipe(debounceTime(300)).subscribe(() => this.schedulePagination()));
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.appearance || changes.layout || changes.committeeFile || changes.gridPreview) {
      this.schedulePagination();
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.schedulePagination();
  }

  ngOnDestroy(): void {
    clearTimeout(this.paginationTimer);
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  resolvedLayout(): CommitteeDocumentLayout {
    return this.layout || this.committeeFile?.document?.layout || CommitteeDocumentLayout.A4_PORTRAIT;
  }

  resolvedAppearance(): DocumentAppearance {
    return this.appearance || this.configuredAppearance;
  }

  headerImage(): string {
    return this.resolvedAppearance().headerImage ? this.urlService.resourceRelativePathForAWSFileName(this.resolvedAppearance().headerImage) : "/assets/images/ramblers/committee-document-papercut.png";
  }

  footerEmail(): string {
    return this.resolvedAppearance().contactEmail || this.contactEmail;
  }

  renderableMarkdown(): string {
    const markdown = this.committeeFile?.document?.markdown || "";
    if (markdown !== this.sourceMarkdown) {
      this.sourceMarkdown = markdown;
    this.encodedMarkdown = encodeMarkdownLinkUrls((this.committeeFile?.document?.markdown || "").replace(/^[ \t]*PAGEBREAK[ \t]*$/gmi, "\n<div class=\"committee-document-page-break\"></div>\n"));
    }
    return this.encodedMarkdown;
  }

  bodyProvidesTitle(): boolean {
    return /^#{1,2}\s/.test((this.committeeFile?.document?.markdown || "").trimStart());
  }

  formattedEventDate(): string {
    return this.dateUtils.asString(this.committeeFile?.eventDate, undefined, this.dateUtils.formats.displayDateTh);
  }

  displayHref(): string {
    return stripTrailingSlash((this.group?.href || "").replace(/^https?:\/\//, ""));
  }

  onMarkdownReady(): void {
    this.schedulePagination();
  }

  private decorateHeadings(host: HTMLElement): void {
    Array.from(host.querySelectorAll("h1, h2")).forEach(heading => {
      if (!heading.querySelector(".committee-document-highlight")) {
        const span = heading.ownerDocument.createElement("span");
        span.className = "committee-document-highlight";
        span.append(...Array.from(heading.childNodes));
        heading.appendChild(span);
      }
    });
  }

  private fitTables(host: HTMLElement): void {
    Array.from(host.querySelectorAll("table")).forEach(table => {
      const rows = Array.from(table.querySelectorAll("tr"));
      const columnCount = Math.max(...rows.map(row => row.children.length), 0);
      if (columnCount < 2 || rows.length < 2) {
      } else {
        const weights = Array.from({length: columnCount}, (ignored, columnIndex) =>
          rows.reduce((sum, row) => sum + ((row.children[columnIndex]?.textContent || "").trim().length), 0));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        if (total === 0) {
        } else {
          const shares = weights.map(weight => weight / total);
          table.querySelector("colgroup")?.remove();
          if (shares.some(share => share >= 0.35)) {
            const colgroup = table.ownerDocument.createElement("colgroup");
            shares.forEach(share => {
              const col = table.ownerDocument.createElement("col");
              if (share >= 0.35) {
                col.style.width = `${Math.min(Math.round(share * 100), 65)}%`;
              }
              colgroup.appendChild(col);
            });
            table.insertBefore(colgroup, table.firstChild);
            table.style.width = "100%";
          }
        }
      }
    });
  }

  schedulePagination(): void {
    if (this.viewReady) {
      clearTimeout(this.paginationTimer);
      this.paginationGeneration += 1;
      const generation = this.paginationGeneration;
      this.paginationTimer = setTimeout(() => {
        this.waitForImages().then(() => {
          if (generation === this.paginationGeneration) {
            this.paginate();
          }
        });
      }, 80);
    }
  }

  private waitForImages(): Promise<void> {
    const images = [...(this.measureHost?.nativeElement?.querySelectorAll("img") || [])]
      .filter(image => !image.complete);
    if (images.length === 0) {
      return Promise.resolve();
    } else {
      return Promise.all(images.map(image => new Promise<void>(resolve => {
        const finish = () => resolve();
        image.addEventListener("load", finish, {once: true});
        image.addEventListener("error", finish, {once: true});
        image.decode().then(finish, finish);
      }))).then(() => undefined);
    }
  }

  private collectBlocks(): void {
    const content = this.masterContent.nativeElement;
    this.fitTables(content);
    this.decorateHeadings(content);
    const markdownHost = content.querySelector("markdown");
    const titleBlock = content.querySelector(".committee-document-title-block");
    const markdownBlocks = markdownHost ? Array.from(markdownHost.children) as HTMLElement[] : [];
    this.contentBlocks = [...(titleBlock ? [titleBlock as HTMLElement] : []), ...markdownBlocks];
  }

  private paginate(): void {
    const host = this.pagesHost?.nativeElement;
    const measureBody = this.measureBody?.nativeElement;
    if (!host || !this.masterContent?.nativeElement || !this.committeeFile?.document || !measureBody) {
    } else {
      this.collectBlocks();
      if (this.contentBlocks.length > 0) {
        this.renderPages(host, measureBody, this.pageBodyHeight(), 0);
      }
    }
  }

  private renderPages(host: HTMLElement, measureBody: HTMLElement, availableHeight: number, attempt: number): void {
    const units = keepTogetherUnits(this.contentBlocks);
    const pages = paginateKeepTogether(units, availableHeight, nodes => this.nodesHeight(measureBody, nodes));
    host.innerHTML = "";
    host.setAttribute("data-layout", this.resolvedLayout());
    const sheets = pages.map(pageUnits => this.buildSheet(pageUnits));
    if (this.resolvedLayout() === CommitteeDocumentLayout.A5_BOOKLET) {
      bookletSpreads(sheets).forEach(pair => {
        const slot = document.createElement("div");
        slot.className = "committee-document-spread-slot";
        const spread = document.createElement("div");
        spread.className = "committee-document-spread";
        pair.forEach(sheet => {
          if (sheet) {
            spread.appendChild(sheet);
          } else {
            const blank = this.buildSheet([]);
            blank.classList.add("committee-document-sheet-blank");
            spread.appendChild(blank);
          }
        });
        slot.appendChild(spread);
        host.appendChild(slot);
      });
      this.applyBookletScale(host);
    } else {
      host.style.removeProperty("--booklet-scale");
      sheets.forEach(sheet => host.appendChild(sheet));
    }
    const tighter = this.overflowingBodyHeight(host);
    if (tighter !== null && tighter < availableHeight && attempt < 6) {
      this.renderPages(host, measureBody, tighter, attempt + 1);
    } else {
      this.logger.info("rendered document into", pages.length, "pages", this.resolvedLayout());
    }
  }

  private overflowingBodyHeight(host: HTMLElement): number | null {
    const overflowing = Array.from(host.querySelectorAll(".committee-document-page-body"))
      .filter((body: HTMLElement) => body.scrollHeight > body.clientHeight + 1) as HTMLElement[];
    if (overflowing.length === 0) {
      return null;
    } else {
      return Math.max(1, Math.min(...overflowing.map(body => body.clientHeight)) - 8);
    }
  }

  private applyBookletScale(host: HTMLElement): void {
    const probe = host.ownerDocument.createElement("div");
    probe.style.width = "297mm";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    host.appendChild(probe);
    const fullWidth = probe.offsetWidth || 1;
    probe.remove();
    host.style.setProperty("--booklet-scale", String(Math.min(1, host.clientWidth / fullWidth)));
  }

  private pageBodyHeight(): number {
    const sheet = this.measureSheet?.nativeElement;
    const header = this.masterHeader?.nativeElement;
    const footer = this.masterFooter?.nativeElement;
    const body = this.measureBody?.nativeElement;
    if (!sheet || !header || !footer || !body) {
      return 900;
    } else {
      body.innerHTML = "";
      const pageHeader = header.cloneNode(true) as HTMLElement;
      const pageFooter = footer.cloneNode(true) as HTMLElement;
      pageFooter.classList.add("committee-document-sheet-footer");
      sheet.prepend(pageHeader);
      sheet.appendChild(pageFooter);
      const bodyStyle = body.ownerDocument.defaultView.getComputedStyle(body);
      const marginY = Number.parseFloat(bodyStyle.marginTop) + Number.parseFloat(bodyStyle.marginBottom);
      const available = sheet.getBoundingClientRect().height - pageHeader.getBoundingClientRect().height - pageFooter.getBoundingClientRect().height - marginY;
      pageHeader.remove();
      pageFooter.remove();
      return Math.max(available - 2, 1);
    }
  }

  private nodesHeight(measureBody: HTMLElement, nodes: HTMLElement[]): number {
    if (nodes.length === 0) {
      return 0;
    } else {
      measureBody.innerHTML = "";
      const clones = nodes.map(node => node.cloneNode(true) as HTMLElement);
      clones.forEach(clone => measureBody.appendChild(clone));
      return Math.max(measureBody.scrollHeight, measureBody.getBoundingClientRect().height);
    }
  }

  private buildSheet(pageUnits: KeepUnit[]): HTMLElement {
    const sheet = document.createElement("div");
    sheet.className = "committee-document-sheet";
    sheet.setAttribute("data-layout", this.resolvedLayout());
    sheet.appendChild(this.masterHeader.nativeElement.cloneNode(true));
    const body = document.createElement("div");
    body.className = "committee-document-body committee-document-page-body";
    this.appendUnits(body, pageUnits);
    sheet.appendChild(body);
    const footer = this.masterFooter.nativeElement.cloneNode(true) as HTMLElement;
    footer.classList.add("committee-document-sheet-footer");
    sheet.appendChild(footer);
    return sheet;
  }

  private appendUnits(body: HTMLElement, pageUnits: KeepUnit[]): void {
    const tables = new Map<HTMLTableElement, HTMLTableElement>();
    pageUnits.forEach(unit => {
      if (unit.kind === KeepUnitKind.TABLE_ROW && unit.table && unit.row) {
        const existing = tables.get(unit.table);
        if (existing) {
          existing.tBodies[0].appendChild(unit.row.cloneNode(true));
        } else {
          const table = unit.table.cloneNode(false) as HTMLTableElement;
          Array.from(unit.table.querySelectorAll("colgroup")).forEach(colgroup => table.appendChild(colgroup.cloneNode(true)));
          if (unit.header) {
            table.appendChild(unit.header.cloneNode(true));
          }
          const tbody = document.createElement("tbody");
          tbody.appendChild(unit.row.cloneNode(true));
          table.appendChild(tbody);
          body.appendChild(table);
          tables.set(unit.table, table);
        }
      } else {
        unit.nodes.forEach(node => body.appendChild(node.cloneNode(true)));
      }
    });
  }
}
