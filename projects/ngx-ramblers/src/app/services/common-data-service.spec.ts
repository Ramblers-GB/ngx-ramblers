import { HttpParams } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { vi } from "vitest";
import { PagedApiResponse } from "../models/api-response.model";
import { CommonDataService } from "./common-data-service";
import { LoggerFactory } from "./logger-factory.service";

describe("CommonDataService", () => {
  const logger = {debug: vi.fn(), info: vi.fn(), error: vi.fn(), off: vi.fn()};
  let service: CommonDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {provide: LoggerFactory, useValue: {createLogger: () => logger}}
      ]
    });
    service = TestBed.inject(CommonDataService);
  });

  it("collects every page rather than stopping at the first", async () => {
    const records = Array.from({length: 2500}, (_, index) => ({index}));
    const requestedPages: number[] = [];
    const fetchPage = (params: HttpParams) => {
      const page = Number(params.get("page"));
      const limit = Number(params.get("limit"));
      requestedPages.push(page);
      const response: PagedApiResponse<{index: number}> = {
        request: null,
        action: null,
        response: records.slice((page - 1) * limit, page * limit),
        pagination: {total: records.length, page, limit, totalPages: Math.ceil(records.length / limit)}
      };
      return of(response);
    };

    const collected = await service.allPages(logger as any, fetchPage, {criteria: {uploadSessionId: "session"}}, 1000);

    expect(collected.length).toEqual(2500);
    expect(requestedPages).toEqual([1, 2, 3]);
  });
});
