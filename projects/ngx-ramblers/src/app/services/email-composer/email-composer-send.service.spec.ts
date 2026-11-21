import { TestBed } from "@angular/core/testing";
import { HttpClient } from "@angular/common/http";
import { Subject } from "rxjs";
import { LoggerTestingModule } from "ngx-logger/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailComposerSendService } from "./email-composer-send.service";
import { WebSocketClientService } from "../websockets/websocket-client.service";
import { AuthService } from "../../auth/auth.service";
import { CommonDataService } from "../common-data-service";
import { BatchSendProgressEvent, BatchSendStatus } from "../../models/email-composer.model";
import { EventType } from "../../models/websocket.model";

describe("email composer progress events", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("resubscribes to the existing job on reconnect and never starts another send", () => {
    const messages = new Subject<BatchSendProgressEvent>();
    const opened = new Subject<void>();
    const sendMessage = vi.fn();
    const post = vi.fn();
    TestBed.configureTestingModule({
      imports: [LoggerTestingModule],
      providers: [
        {provide: HttpClient, useValue: {post}},
        {provide: CommonDataService, useValue: {}},
        {provide: AuthService, useValue: {authToken: () => "example-token", tokenExpired: () => false}},
        {provide: WebSocketClientService, useValue: {receiveMessages: () => messages, connectionOpened: () => opened, sendMessage}}
      ]
    });
    const service = TestBed.inject(EmailComposerSendService);
    const received: number[] = [];
    const subscription = service.batchEvents("example-job").subscribe(progress => received.push(progress.sentCount));
    const progress = {jobId: "example-job", status: BatchSendStatus.RUNNING, totalRecipients: 8000, sentCount: 5, failedCount: 0, skippedCount: 0, startedAt: 1, entries: []};
    messages.next({jobId: "other-job", snapshot: true, progress});
    expect(received).toEqual([]);
    messages.next({jobId: "example-job", snapshot: true, progress});
    opened.next();
    messages.next({jobId: "example-job", snapshot: true, progress: {...progress, sentCount: 9}});
    expect(received).toEqual([5, 9]);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(EventType.BATCH_SEND_PROGRESS, {jobId: "example-job"}, "example-token");
    expect(post).not.toHaveBeenCalled();
    subscription.unsubscribe();
    expect(sendMessage).toHaveBeenLastCalledWith(EventType.BATCH_SEND_PROGRESS, {jobId: "example-job", unsubscribe: true}, "example-token");
  });
});
