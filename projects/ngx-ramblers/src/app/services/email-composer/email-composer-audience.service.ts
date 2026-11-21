import { HttpClient, HttpParams } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import {
  ComposerAudienceDefinition,
  ComposerAudiencePage,
  ComposerAudiencePageRequest,
  ComposerAudiencePageResponse,
  ComposerFilterSelection,
  ComposerFilterSelectionRequest,
  ComposerFilterSelectionResponse,
  ComposerListCount,
  ComposerListCountsResponse,
  ComposerMemberIdsResponse,
  ComposerMemberLookupRequest,
  ComposerMembersResponse,
  ComposerMemberSearchResponse,
  ComposerMemberSearchResult
} from "../../models/email-composer.model";
import { Member } from "../../models/member.model";
import { CommonDataService } from "../common-data-service";
import { Logger, LoggerFactory } from "../logger-factory.service";

@Injectable({providedIn: "root"})
export class EmailComposerAudienceService {
  private readonly logger: Logger = inject(LoggerFactory).createLogger("EmailComposerAudienceService", NgxLoggerLevel.ERROR);
  private http = inject(HttpClient);
  private commonDataService = inject(CommonDataService);
  private readonly BASE_URL = "/api/database/email-composer-audience";

  async searchMembers(search: string): Promise<ComposerMemberSearchResult[]> {
    const params = new HttpParams().set("search", search);
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.get<ComposerMemberSearchResponse>(`${this.BASE_URL}/members`, {params}));
    return apiResponse.response ?? [];
  }

  async filterSelection(request: ComposerFilterSelectionRequest): Promise<ComposerFilterSelection> {
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.post<ComposerFilterSelectionResponse>(`${this.BASE_URL}/selection`, request));
    return apiResponse.response;
  }

  async listCounts(listIds: number[]): Promise<ComposerListCount[]> {
    const params = new HttpParams().set("listIds", listIds.join(","));
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.get<ComposerListCountsResponse>(`${this.BASE_URL}/list-counts`, {params}));
    return apiResponse.response ?? [];
  }

  async memberIds(definition: ComposerAudienceDefinition): Promise<string[]> {
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.post<ComposerMemberIdsResponse>(`${this.BASE_URL}/member-ids`, {definition}));
    return apiResponse.response ?? [];
  }

  async members(request: ComposerMemberLookupRequest): Promise<Member[]> {
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.post<ComposerMembersResponse>(`${this.BASE_URL}/members`, request));
    return apiResponse.response ?? [];
  }

  async page(request: ComposerAudiencePageRequest): Promise<ComposerAudiencePage> {
    const apiResponse = await this.commonDataService.responseFrom(this.logger, this.http.post<ComposerAudiencePageResponse>(`${this.BASE_URL}/page`, request));
    return apiResponse.response;
  }
}
