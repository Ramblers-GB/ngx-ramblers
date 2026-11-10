import {TestBed} from "@angular/core/testing";
import {afterEach, describe, expect, it, vi} from "vitest";
import {of} from "rxjs";
import {LoggerTestingModule} from "ngx-logger/testing";
import {SystemConfigService} from "../../../services/system/system-config.service";
import {CommitteeConfigService} from "../../../services/committee/commitee-config.service";
import {DateUtilsService} from "../../../services/date-utils.service";
import {UrlService} from "../../../services/url.service";
import {CommitteeDocumentView} from "./committee-document-view";

describe("document page measurements", () => {
  afterEach(() => vi.restoreAllMocks());

  it("measures the header and footer inside the paper-width sheet", () => {
    TestBed.configureTestingModule({imports: [CommitteeDocumentView, LoggerTestingModule], providers: [
      {provide: SystemConfigService, useValue: {events: () => of({group: {longName: "Hillside Park"}})}},
      {provide: CommitteeConfigService, useValue: {committeeReferenceDataEvents: () => of({contactUsFieldForBuiltInRole: () => "contact@group.example.org.uk"})}},
      {provide: DateUtilsService, useValue: {}},
      {provide: UrlService, useValue: {}}
    ]});
    TestBed.overrideComponent(CommitteeDocumentView, {set: {template: `
      <div #masterHeader class="page-header"></div>
      <div #masterFooter class="page-footer"></div>
      <div #measureSheet class="paper-sheet"><div #measureBody style="margin-top: 10px; margin-bottom: 20px"></div></div>
    `}});
    const fixture = TestBed.createComponent(CommitteeDocumentView);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const sheet = host.querySelector(".paper-sheet");
    const measuredParents: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("page-header") || this.classList.contains("page-footer")) {
        measuredParents.push(this.parentElement);
      }
      const height = this.classList.contains("paper-sheet") ? 1000 : this.classList.contains("page-header") ? 100 : 150;
      return {height} as DOMRect;
    });
    expect(fixture.componentInstance["pageBodyHeight"]()).toBe(718);
    expect(measuredParents).toEqual([sheet, sheet]);
    expect(sheet.children).toHaveLength(1);
    fixture.destroy();
  });

  it("reduces the page body height when a rendered sheet overflows", () => {
    TestBed.configureTestingModule({imports: [CommitteeDocumentView, LoggerTestingModule], providers: [
      {provide: SystemConfigService, useValue: {events: () => of({})}},
      {provide: CommitteeConfigService, useValue: {committeeReferenceDataEvents: () => of({})}},
      {provide: DateUtilsService, useValue: {}},
      {provide: UrlService, useValue: {}}
    ]});
    TestBed.overrideComponent(CommitteeDocumentView, {set: {template: `<div></div>`}});
    const fixture = TestBed.createComponent(CommitteeDocumentView);
    const host = fixture.nativeElement.ownerDocument.createElement("div");
    host.innerHTML = `<div class="committee-document-page-body"></div>`;
    const body = host.querySelector(".committee-document-page-body") as HTMLElement;
    Object.defineProperty(body, "scrollHeight", {value: 400});
    Object.defineProperty(body, "clientHeight", {value: 300});
    expect(fixture.componentInstance["overflowingBodyHeight"](host)).toBe(292);
    fixture.destroy();
  });
});
