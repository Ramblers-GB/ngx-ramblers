import { HttpErrorResponse, HttpParams } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { chunk, forEach as each, isObject } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { firstValueFrom, Observable, Subject } from "rxjs";
import { ApiResponse, PagedApiResponse } from "../models/api-response.model";
import { DataQueryOptions, PAGE_FETCH_CONCURRENCY } from "../models/api-request.model";
import { Logger, LoggerFactory } from "./logger-factory.service";
import { StringUtilsService } from "./string-utils.service";

@Injectable({
  providedIn: "root"
})

export class CommonDataService {

  private logger: Logger = inject(LoggerFactory).createLogger("CommonDataService", NgxLoggerLevel.ERROR);
  private stringUtils = inject(StringUtilsService);

  public async responseFrom<T extends ApiResponse>(logger: Logger, observable: Observable<T>, notifications?: Subject<T>, rejectOnError?: boolean): Promise<T> {
    const notificationSubject = notifications || new Subject<T>();
    try {
      const apiResponse = await firstValueFrom(observable);
      logger.debug("api response:", apiResponse);
      notificationSubject.next(apiResponse);
      if (rejectOnError && apiResponse.error) {
        return Promise.reject("Update failed due to error: " + this.stringUtils.stringifyObject(apiResponse.error));
      }
      return apiResponse;
    } catch (httpErrorResponse) {
      if ((httpErrorResponse as HttpErrorResponse)?.status === 401) {
        logger.info("unauthorised response - session no longer valid:", httpErrorResponse);
      } else {
        logger.error("http error response", httpErrorResponse);
      }
      notificationSubject.next((httpErrorResponse as HttpErrorResponse).error);
      throw httpErrorResponse;
    }
  }

  public async allPages<T>(logger: Logger, fetchPage: (params: HttpParams) => Observable<PagedApiResponse<T>>, dataQueryOptions: DataQueryOptions, pageSize: number): Promise<T[]> {
    const sort = {...(dataQueryOptions?.sort ?? {}), _id: dataQueryOptions?.sort?._id ?? 1};
    const pageOf = (page: number) => this.responseFrom(logger, fetchPage(this.toHttpParams({...dataQueryOptions, sort, page, limit: pageSize})));
    const first = await pageOf(1);
    const remainingPages = Array.from({length: Math.max(0, (first.pagination?.totalPages ?? 1) - 1)}, (_, index) => index + 2);
    const later = await chunk(remainingPages, PAGE_FETCH_CONCURRENCY).reduce(async (collected: Promise<PagedApiResponse<T>[]>, batch: number[]) => {
      const pages = await collected;
      return [...pages, ...await Promise.all(batch.map(page => pageOf(page)))];
    }, Promise.resolve([] as PagedApiResponse<T>[]));
    return [first, ...later].flatMap(page => page.response ?? []);
  }

  public toHttpParams(criteria: object): HttpParams {
    let params = new HttpParams();
    each(criteria, (value, field) => {
      const paramValue = isObject(value) ? JSON.stringify(value) : value;
      params = params.set(field, paramValue);
      this.logger.off("query setting params field:", field, "value:", paramValue);
    });
    return params;
  }
}
