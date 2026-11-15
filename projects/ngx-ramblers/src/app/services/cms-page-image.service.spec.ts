import { vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { LoggerTestingModule } from "ngx-logger/testing";
import { PageContentType } from "../models/content-text.model";
import { CmsPageImageService } from "./cms-page-image.service";
import { LocationExtractionService } from "./location-extraction.service";
import { PageContentService } from "./page-content.service";
import { StringUtilsService } from "./string-utils.service";
import { UrlService } from "./url.service";

describe("CmsPageImageService", () => {
  let service: CmsPageImageService;
  const pageContentService = {
    findByPath: vi.fn(),
    all: vi.fn()
  };

  beforeEach(() => {
    pageContentService.findByPath.mockReset();
    pageContentService.all.mockReset();
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule],
      providers: [
        CmsPageImageService,
        {provide: PageContentService, useValue: pageContentService},
        {
          provide: LocationExtractionService,
          useValue: {
            findAllImagesInPage: (page: any) => (page.rows || [])
              .flatMap((row: any) => row.columns || [])
              .map((column: any) => column.imageSource)
              .filter(Boolean)
          }
        },
        {provide: StringUtilsService, useValue: {stripMarkdown: (value: string) => value}},
        {
          provide: UrlService,
          useValue: {
            isRemoteUrl: (src: string) => /^https?:\/\//.test(src),
            imageSource: (src: string) => `/api/aws/s3/${src}`
          }
        }
      ]
    });
    service = TestBed.inject(CmsPageImageService);
  });

  it("pagesForPicker keeps nearby pages first and appends other pages that have images", async () => {
    const nearby = {
      path: "committee/2026",
      rows: [{type: PageContentType.TEXT, columns: [{imageSource: "site-content/year.jpg"}]}]
    };
    const home = {
      path: "home",
      rows: [{type: PageContentType.TEXT, columns: [{imageSource: "site-content/home.jpg"}]}]
    };
    const empty = {path: "about-us", rows: [{type: PageContentType.TEXT, columns: [{}]}]};
    pageContentService.findByPath.mockResolvedValue(nearby);
    pageContentService.all.mockImplementation(async (options: any) => {
      if (options?.criteria) {
        return [nearby];
      } else {
        return [nearby, home, empty];
      }
    });

    const pages = await service.pagesForPicker(["committee/2026"]);
    expect(pages.map(page => page.path)).toEqual(["committee/2026", "home"]);
    expect(pages[0].images[0].src).toBe("site-content/year.jpg");
    expect(pages[1].images[0].src).toBe("site-content/home.jpg");
  });
});
