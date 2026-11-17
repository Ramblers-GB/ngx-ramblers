import { Injectable } from "@angular/core";
import { InboxThread, InboxGroupingMode } from "../../models/inbox.model";
import { inboxThreadId } from "../../functions/inbox-thread";

@Injectable()
export class InboxConversationsService {
  private siblingsByConversationKey = new Map<string, InboxThread[]>();
  private siblingsBySentSubject = new Map<string, InboxThread[]>();
  private siblingsByFirstMessage = new Map<string, InboxThread[]>();

  siblingConversationThreads(thread: InboxThread, viewingSent = false): InboxThread[] {
    const conversationKey = thread.conversationKey;
    if (conversationKey) {
      return this.siblingsByConversationKey.get(conversationKey) ?? [thread];
    } else if (viewingSent) {
      const subjectKey = this.sentSubjectKey(thread);
      return subjectKey ? (this.siblingsBySentSubject.get(subjectKey) ?? [thread]) : [thread];
    } else {
      const messageKey = this.firstMessageKey(thread);
      return messageKey ? (this.siblingsByFirstMessage.get(messageKey) ?? [thread]) : [thread];
    }
  }

  index(threads: InboxThread[]): void {
    const byKey = new Map<string, InboxThread[]>();
    const bySentSubject = new Map<string, InboxThread[]>();
    const byFirstMessage = new Map<string, InboxThread[]>();
    threads.forEach(thread => {
      const conversationKey = thread.conversationKey;
      if (conversationKey) {
        this.appendSibling(byKey, conversationKey, thread);
      } else {
        const subjectKey = this.sentSubjectKey(thread);
        if (subjectKey) {
          this.appendSibling(bySentSubject, subjectKey, thread);
        }
        const messageKey = this.firstMessageKey(thread);
        if (messageKey) {
          this.appendSibling(byFirstMessage, messageKey, thread);
        }
      }
    });
    this.siblingsByConversationKey = byKey;
    this.siblingsBySentSubject = bySentSubject;
    this.siblingsByFirstMessage = byFirstMessage;
  }

  representativeThread(threads: InboxThread[]): InboxThread {
    return threads.reduce((latest, candidate) => (candidate.lastSeenAt ?? candidate.firstSeenAt ?? 0) > (latest.lastSeenAt ?? latest.firstSeenAt ?? 0) ? candidate : latest);
  }

  conversationRepresentatives(threads: InboxThread[], groupingMode: InboxGroupingMode, viewingSent: boolean): InboxThread[] {
    if (groupingMode === InboxGroupingMode.MESSAGES) {
      return threads;
    } else if (viewingSent) {
      const seenKeys = new Set<string>();
      return threads.filter(thread => {
        const key = thread.conversationKey || this.sentSubjectKey(thread) || inboxThreadId(thread);
        if (seenKeys.has(key)) {
          return false;
        } else {
          seenKeys.add(key);
          return true;
        }
      });
    } else {
      const seenKeys = new Set<string>();
      const representatives: InboxThread[] = [];
      threads.forEach(thread => {
        const key = thread.conversationKey || this.firstMessageKey(thread);
        if (!key) {
          representatives.push(thread);
        } else if (!seenKeys.has(key)) {
          seenKeys.add(key);
          representatives.push(this.representativeThread(this.siblingConversationThreads(thread)));
        }
      });
      return representatives;
    }
  }

  private firstMessageKey(thread: InboxThread): string | null {
    const messageId = thread.messageIds?.[0]?.trim();
    return messageId ? `message:${messageId.toLowerCase()}` : null;
  }

  private sentSubjectKey(thread: InboxThread): string | null {
    const subject = (thread.normalisedSubject || thread.subject || "").trim().toLowerCase();
    return subject || null;
  }

  private appendSibling(byKey: Map<string, InboxThread[]>, key: string, thread: InboxThread): void {
    const group = byKey.get(key);
    if (group) {
      group.push(thread);
    } else {
      byKey.set(key, [thread]);
    }
  }
}
