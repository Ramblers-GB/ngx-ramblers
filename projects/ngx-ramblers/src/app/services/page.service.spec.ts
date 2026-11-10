import {vi} from "vitest";
import {PageContentService} from "./page-content.service";
import {PageContent, PageContentType} from "../models/content-text.model";
import {Organisation} from "../models/system.model";
import {RamblersEventType} from "../models/ramblers-walks-manager.model";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { RouterTestingModule } from "@angular/router/testing";
import { LoggerTestingModule } from "ngx-logger/testing";
import { FullNameWithAliasPipe } from "../pipes/full-name-with-alias.pipe";
import { FullNamePipe } from "../pipes/full-name.pipe";
import { MemberIdToFullNamePipe } from "../pipes/member-id-to-full-name.pipe";
import { PageService } from "./page.service";
import { provideHttpClient, withInterceptorsFromDi } from "@angular/common/http";

describe("PageService", () => {
  let service: PageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule, RouterTestingModule],
      providers: [
        MemberIdToFullNamePipe,
        FullNamePipe,
        FullNameWithAliasPipe,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(PageService);
  });

  it("resolves event destinations from the navbar and its page content", async () => {
    service.group = {pages: [{href: "our-programme", title: "Programme"}, {href: "gatherings", title: "Gatherings"}]} as Organisation;
    const all = vi.spyOn(TestBed.inject(PageContentService), "all").mockResolvedValue([
      {path: "our-programme", rows: [{type: PageContentType.EVENTS, events: {eventTypes: [RamblersEventType.GROUP_WALK]}}]},
      {path: "gatherings", rows: [{type: PageContentType.EVENTS, events: {eventTypes: [RamblersEventType.GROUP_EVENT]}}]}
    ] as PageContent[]);
    const pages = await service.eventPagesFor([RamblersEventType.GROUP_WALK, RamblersEventType.GROUP_EVENT]);
    expect(pages.get(RamblersEventType.GROUP_WALK)?.href).toBe("our-programme");
    expect(pages.get(RamblersEventType.GROUP_EVENT)?.href).toBe("gatherings");
    expect(all).toHaveBeenCalledTimes(1);
  });

  describe("titleFromPath", () => {
    it("should convert a simple path to a title", () => {
      expect(service.titleFromPath("council")).toBe("Council");
    });

    it("should convert a multi-segment path to a slash-separated title", () => {
      expect(service.titleFromPath("council/meetings")).toBe("Council / Meetings");
    });

    it("should convert a date-based path to a readable title", () => {
      expect(service.titleFromPath("council/meetings/2023-03-09")).toBe("Council / Meetings / 2023 03 09");
    });

    it("should handle a deeply nested path", () => {
      expect(service.titleFromPath("admin/settings/system-settings")).toBe("Admin / Settings / System Settings");
    });

    it("should handle an empty string", () => {
      expect(service.titleFromPath("")).toBe("");
    });

    it("should handle null", () => {
      expect(service.titleFromPath(null)).toBe("");
    });

    it("should handle undefined", () => {
      expect(service.titleFromPath(undefined)).toBe("");
    });

    it("should handle a path with leading slash", () => {
      expect(service.titleFromPath("/council/meetings")).toBe("Council / Meetings");
    });

    it("should handle kebab-case segments", () => {
      expect(service.titleFromPath("social-events/upcoming")).toBe("Social Events / Upcoming");
    });
  });

  describe("subtitleFrom", () => {
    it("should convert a kebab-case segment to a title", () => {
      expect(service.subtitleFrom("social-events")).toBe("Social Events");
    });

    it("should convert a simple segment to a title", () => {
      expect(service.subtitleFrom("walks")).toBe("Walks");
    });
  });
});
