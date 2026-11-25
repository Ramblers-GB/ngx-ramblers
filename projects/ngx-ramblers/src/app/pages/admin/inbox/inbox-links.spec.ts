import { describe, expect, it, vi } from "vitest";
import { InboxConversationsService } from "../../../services/inbox/inbox-conversations.service";
import { InboxComponent } from "./inbox.component";
import { InboxMessageDirection, InboxThreadFolder, InboxViewScope } from "../../../models/inbox.model";
import { StoredValue } from "../../../models/ui-actions.model";

function inbox(): any {
  const instance = Object.create(InboxComponent.prototype);
  Object.assign(instance, {
    selectedMailboxView: InboxThreadFolder.SENT,
    conversations: new InboxConversationsService(),
    threads: [],
    aliases: [],
    route: {snapshot: {queryParams: {
      [StoredValue.MAILBOX_VIEW]: InboxThreadFolder.SENT,
      [StoredValue.THREAD]: "thread-1",
      [StoredValue.MESSAGE]: "<older@example.org>"
    }}},
    logger: {error: vi.fn()},
    inboxService: {getThread: vi.fn(), listThreads: vi.fn()}
  });
  return instance;
}

describe("Sent item links", () => {
  it("selects the requested message when newer sends share the thread", async () => {
    const instance = inbox();
    const newer = {id: "thread-1", slug: "request", folder: InboxThreadFolder.INBOX, sentMessageId: "<newer@example.org>"};
    const older = {...newer, sentMessageId: "<older@example.org>"};
    instance.threads = [newer, older];
    expect(await instance.threadRequestedInUrl()).toEqual(older);
    expect(instance.inboxService.getThread).not.toHaveBeenCalled();
  });

  it("loads an older Sent item outside the current page using the existing Sent listing", async () => {
    const instance = inbox();
    const thread = {id: "thread-1", slug: "request", subject: "A request", folder: InboxThreadFolder.INBOX};
    const message = {messageId: "<older@example.org>", direction: InboxMessageDirection.OUTBOUND, subject: "A request"};
    const sent = {...thread, sentMessageId: message.messageId};
    instance.inboxService.getThread.mockResolvedValue({thread, messages: [message]});
    instance.inboxService.listThreads
      .mockResolvedValueOnce({threads: [{id: "thread-2", sentMessageId: "<other@example.org>"}], totalCount: 2})
      .mockResolvedValueOnce({threads: [sent], totalCount: 2});
    expect(await instance.threadRequestedInUrl()).toEqual(sent);
    expect(instance.threads).toEqual([sent]);
    expect(instance.inboxService.listThreads).toHaveBeenLastCalledWith(null, InboxViewScope.ALL_ACCESSIBLE, false, 200, InboxThreadFolder.SENT, 1, "A request");
  });

  it("keeps an older Sent item selected when the conversation is refreshed", async () => {
    const instance = inbox();
    const newer = {id: "thread-1", sentMessageId: "<newer@example.org>"};
    const older = {...newer, sentMessageId: "<older@example.org>"};
    instance.threads = [newer, older];
    instance.selectedThreadId = "thread-1";
    instance.sentFocusMessageId = older.sentMessageId;
    instance.selectedMessages = [];
    instance.openThread = vi.fn().mockResolvedValue(null);
    await instance.reloadVisibleConversation(older);
    expect(instance.openThread).toHaveBeenCalledWith(older, false);
  });

  it("opens the requested Sent item instead of the first message during initial refresh", async () => {
    const instance = inbox();
    const requested = {id: "thread-1", sentMessageId: "<older@example.org>"};
    Object.assign(instance, {
      refreshRequestId: 0,
      mailboxViewInitialised: true,
      aliases: [{roleType: "chair"}],
      loadDrafts: vi.fn(),
      loadUserFolders: vi.fn(),
      normaliseMailboxViewAfterFoldersLoad: vi.fn(),
      threadRequestedInUrl: vi.fn().mockResolvedValue(requested),
      reloadVisibleConversation: vi.fn(),
      notify: {error: vi.fn()},
      inboxNotificationService: {resync: vi.fn()}
    });
    instance.inboxService.listThreads.mockResolvedValue({threads: [{id: "another-thread"}], totalCount: 2, unreadCount: 0});
    await instance.refresh(false);
    expect(instance.reloadVisibleConversation).toHaveBeenCalledWith(requested);
    expect(instance.notify.error).not.toHaveBeenCalled();
  });

  it("does not expose an incoming message as a Sent item", async () => {
    const instance = inbox();
    instance.inboxService.getThread.mockResolvedValue({
      thread: {id: "thread-1", subject: "A request", folder: InboxThreadFolder.INBOX},
      messages: [{messageId: "<older@example.org>", direction: InboxMessageDirection.INBOUND}]
    });
    expect(await instance.threadRequestedInUrl()).toBeNull();
    expect(instance.inboxService.listThreads).not.toHaveBeenCalled();
    expect(instance.selectedMailboxView).toBe(InboxThreadFolder.SENT);
  });

  it("does not show a deleted thread in Sent", async () => {
    const instance = inbox();
    const message = {messageId: "<older@example.org>", direction: InboxMessageDirection.OUTBOUND};
    const thread = {id: "thread-1", subject: "A request", folder: InboxThreadFolder.DELETED, sentMessageId: message.messageId};
    instance.inboxService.getThread.mockResolvedValue({thread, messages: [message]});
    instance.inboxService.listThreads.mockResolvedValue({threads: [thread], totalCount: 1});
    expect(await instance.threadRequestedInUrl()).toBeNull();
    expect(instance.threads).toEqual([]);
  });

  it("writes the selected sent message into the URL and clears it outside Sent", () => {
    const instance = inbox();
    instance.router = {navigate: vi.fn()};
    instance.layout = {mobile: false};
    const thread = {id: "thread-1", slug: "request", sentMessageId: "<older@example.org>"};
    instance.syncThreadToUrl(thread);
    expect(instance.router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: {[StoredValue.THREAD]: "request", [StoredValue.MESSAGE]: "<older@example.org>"}
    }));
    instance.selectedMailboxView = InboxViewScope.ALL_ACCESSIBLE;
    instance.syncThreadToUrl(thread);
    expect(instance.router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: {[StoredValue.THREAD]: "request", [StoredValue.MESSAGE]: null}
    }));
  });
});
