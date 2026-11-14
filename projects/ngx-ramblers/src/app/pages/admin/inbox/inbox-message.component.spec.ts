import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { InboxMessage, InboxMessageDirection } from "../../../models/inbox.model";
import { InboxMessageRenderingService } from "../../../services/inbox/inbox-message-rendering.service";
import { InboxService } from "../../../services/inbox/inbox.service";
import { LoggerFactory } from "../../../services/logger-factory.service";
import { NumberUtilsService } from "../../../services/number-utils.service";
import { InboxMessageComponent } from "./inbox-message.component";

describe("Inbox message mirror link", () => {
  it("retries an unavailable link when reopened and keeps the resolved address", async () => {
    const hosted = "https://mail.example.org/hosted";
    const viewInBrowserUrl = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(hosted);
    TestBed.configureTestingModule({providers: [
      {provide: InboxMessageRenderingService, useValue: {}},
      {provide: InboxService, useValue: {viewInBrowserUrl}},
      {provide: LoggerFactory, useValue: {createLogger: () => ({error: vi.fn()})}},
      {provide: NumberUtilsService, useValue: {}}
    ]});
    const component = TestBed.runInInjectionContext(() => new InboxMessageComponent());
    component.message = {
      threadId: "example-thread",
      messageId: "example-message",
      direction: InboxMessageDirection.OUTBOUND,
      bodyHtml: `<a href="{{ mirror }}">View in browser</a>`
    } as InboxMessage;

    component.initiallyExpanded = true;
    await Promise.resolve();
    component["toggleMessage"]();
    component["toggleMessage"]();
    await Promise.resolve();
    component["toggleMessage"]();
    component["toggleMessage"]();

    expect(viewInBrowserUrl).toHaveBeenCalledTimes(2);
    expect(viewInBrowserUrl).toHaveBeenLastCalledWith("example-thread", "example-message");
    expect(component["viewInBrowserUrl"]).toBe(hosted);
  });
});
