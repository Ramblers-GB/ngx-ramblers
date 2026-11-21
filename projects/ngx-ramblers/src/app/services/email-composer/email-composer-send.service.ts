import { Observable, retry, Subscription, throwError, timer } from "rxjs";
import { WebSocketClientService } from "../websockets/websocket-client.service";
import { AuthService } from "../../auth/auth.service";
import { EventType, MessageType } from "../../models/websocket.model";
import { mergeBatchProgress } from "../../functions/batch-send-progress";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { NgxLoggerLevel } from "ngx-logger";
import { Logger, LoggerFactory } from "../logger-factory.service";
import { CommonDataService } from "../common-data-service";
import { ApiResponse } from "../../models/api-response.model";
import { BatchSendProgress, BatchSendProgressEvent, BatchSendStartResponse, BatchTransactionalSendRequest } from "../../models/email-composer.model";

@Injectable({ providedIn: "root" })
export class EmailComposerSendService {

  private websocket = inject(WebSocketClientService);
  private auth = inject(AuthService);
  private logger: Logger = inject(LoggerFactory).createLogger("EmailComposerSendService", NgxLoggerLevel.ERROR);
  private http = inject(HttpClient);
  private commonDataService = inject(CommonDataService);
  private BASE_URL = "api/mail/transactional/batch";

  async startBatch(request: BatchTransactionalSendRequest): Promise<BatchSendStartResponse> {
    this.logger.info("startBatch:", request);
    const response = await this.commonDataService.responseFrom(this.logger, this.http.post<ApiResponse>(`${this.BASE_URL}/start`, request));
    return response.response as BatchSendStartResponse;
  }

  batchEvents(jobId: string): Observable<BatchSendProgress> {
    return new Observable(observer => {
      const entriesById = new Map<string, number>();
      const state: {progress: BatchSendProgress | null} = {progress: null};
      const subscriptions = new Subscription();
      const sendWatch = () => this.websocket.sendMessage(EventType.BATCH_SEND_PROGRESS, {jobId}, this.auth.authToken());
      const watch = () => {
        if (this.auth.tokenExpired()) {
          subscriptions.add(this.auth.performTokenRefresh().pipe(retry({
            delay: (error, count) => error?.status === 401 || error?.status === 403
              ? throwError(() => error)
              : timer(Math.min(count * 1500, 10000))
          })).subscribe({next: sendWatch, error: error => observer.error(error)}));
        } else {
          sendWatch();
        }
      };
      const events = this.websocket.receiveMessages<BatchSendProgressEvent>(MessageType.BATCH_SEND_PROGRESS).subscribe(event => {
        if (event.jobId === jobId) {
          if (event.error) {
            observer.error(new HttpErrorResponse({status: event.error.status, error: {error: {message: event.error.message}}}));
          } else if (event.progress) {
            state.progress = mergeBatchProgress(state.progress, event, entriesById);
            observer.next(state.progress);
          }
        }
      });
      const reconnect = this.websocket.connectionOpened().subscribe(watch);
      watch();
      return () => {
        subscriptions.unsubscribe();
        events.unsubscribe();
        reconnect.unsubscribe();
        this.websocket.sendMessage(EventType.BATCH_SEND_PROGRESS, {jobId, unsubscribe: true}, this.auth.authToken());
      };
    });
  }

  async batchStatus(jobId: string): Promise<BatchSendProgress> {
    const response = await this.commonDataService.responseFrom(this.logger, this.http.get<ApiResponse>(`${this.BASE_URL}/${encodeURIComponent(jobId)}`));
    return response.response as BatchSendProgress;
  }

  async cancelBatch(jobId: string): Promise<BatchSendProgress> {
    this.logger.info("cancelBatch:", jobId);
    const response = await this.commonDataService.responseFrom(this.logger, this.http.post<ApiResponse>(`${this.BASE_URL}/${encodeURIComponent(jobId)}/cancel`, {}));
    return response.response as BatchSendProgress;
  }

  async resolveTrackingUrl(url: string): Promise<{ originalUrl: string; resolvedUrl: string | null; error?: string; lastUrl?: string; hops?: number }> {
    const response = await this.http.post<{ originalUrl: string; resolvedUrl: string | null; error?: string; lastUrl?: string; hops?: number }>(`api/mail/transactional/resolve-tracking-url`, { url }).toPromise();
    return response!;
  }
}
