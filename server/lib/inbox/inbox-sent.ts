import { Types } from "mongoose";
import { foldersExcludedFromLiveMatch, InboxAddress, InboxMessage, InboxMessageDirection, InboxThread } from "../../../projects/ngx-ramblers/src/app/models/inbox.model";
import { inboxThreadId } from "../../../projects/ngx-ramblers/src/app/functions/inbox-thread";

export interface SentMessageRowsResult {
  rows: InboxThread[];
  totalCount: number;
}

export function sentMessageFilter(): Record<string, unknown> {
  return {direction: InboxMessageDirection.OUTBOUND, autoReply: {$ne: true}};
}

export function sentFolderFilter(): Record<string, unknown> {
  return {$nin: foldersExcludedFromLiveMatch()};
}

export function sentThreadObjectIds(threadIds: string[]): Types.ObjectId[] {
  return threadIds
    .filter(threadId => Types.ObjectId.isValid(threadId) && String(new Types.ObjectId(threadId)) === threadId)
    .map(threadId => new Types.ObjectId(threadId));
}

export const SENT_COPY_REPLACE_WINDOW_MS = 30 * 60 * 1000;

export function sentMessageRows(threads: InboxThread[], messages: InboxMessage[], offset: number, limit: number): SentMessageRowsResult {
  const threadsById = new Map(threads.map(thread => [inboxThreadId(thread), thread]));
  const seenMessageIds = new Set<string>();
  const keptCopies: {identity: string; sentAt: number}[] = [];
  const rows = messages
    .filter(message => threadsById.has(String(message.threadId)))
    .filter(message => !emptySentStub(message))
    .filter(message => {
      if (seenMessageIds.has(message.messageId)) {
        return false;
      } else {
        seenMessageIds.add(message.messageId);
        return true;
      }
    })
    .sort((left, right) => (right.sentAt ?? right.receivedAt ?? 0) - (left.sentAt ?? left.receivedAt ?? 0))
    .filter(message => {
      const identity = sentCopyConversation(message);
      const sentAt = message.sentAt ?? message.receivedAt ?? 0;
      if (keptCopies.some(kept => kept.identity === identity && Math.abs(kept.sentAt - sentAt) <= SENT_COPY_REPLACE_WINDOW_MS)) {
        return false;
      } else {
        keptCopies.push({identity, sentAt});
        return true;
      }
    })
    .map(message => sentRowFor(threadsById.get(String(message.threadId)), message));
  return {rows: rows.slice(offset, offset + limit), totalCount: rows.length};
}

export function emptySentStub(message: Pick<InboxMessage, "subject" | "to" | "bodyHtml" | "bodyText">): boolean {
  const subject = (message.subject || "").trim();
  const noSubject = !subject || subject === "(no subject)";
  const noRecipient = !(message.to ?? []).some(recipient => !!recipient?.email);
  const noBody = !(message.bodyHtml || "").trim() && !(message.bodyText || "").trim();
  return noSubject && noRecipient && (message.bodyHtml === undefined && message.bodyText === undefined ? true : noBody);
}

export function sentCopyConversation(message: Pick<InboxMessage, "subject" | "from" | "to">): string {
  const recipients = (message.to ?? []).map(recipient => (recipient.email || "").trim().toLowerCase()).filter(Boolean).sort().join(",");
  const subject = (message.subject || "").trim().toLowerCase();
  const from = (message.from?.email || "").trim().toLowerCase();
  return `${from}|${subject}|${recipients}`;
}

export function isRecentSentCopy(
  left: Pick<InboxMessage, "subject" | "from" | "to" | "sentAt" | "receivedAt" | "bodyHtml" | "bodyText">,
  right: Pick<InboxMessage, "subject" | "from" | "to" | "sentAt" | "receivedAt" | "bodyHtml" | "bodyText">
): boolean {
  const leftAt = left.sentAt ?? left.receivedAt ?? 0;
  const rightAt = right.sentAt ?? right.receivedAt ?? 0;
  const leftBody = sentCopyBody(left);
  const rightBody = sentCopyBody(right);
  const sameBody = Boolean(leftBody) && leftBody === rightBody;
  const oneBodyMissing = !leftBody || !rightBody;
  return sentCopyConversation(left) === sentCopyConversation(right)
    && Math.abs(leftAt - rightAt) <= SENT_COPY_REPLACE_WINDOW_MS
    && (sameBody || oneBodyMissing);
}

function sentCopyBody(message: Pick<InboxMessage, "bodyHtml" | "bodyText">): string {
  const text = (message.bodyText || "").trim();
  if (text) {
    return text.toLowerCase();
  } else {
    return (message.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }
}

function sentRowFor(thread: InboxThread, message: InboxMessage): InboxThread {
  return {
    ...thread,
    subject: message.subject || thread.subject,
    externalAddress: sentRecipientAddress(message) ?? thread.externalAddress,
    sentFrom: message.from?.email ? message.from : thread.sentFrom,
    lastDirection: InboxMessageDirection.OUTBOUND,
    lastOutboundAt: message.sentAt ?? message.receivedAt ?? 0,
    sentMessageId: message.messageId
  };
}

function sentRecipientAddress(message: InboxMessage): InboxAddress | null {
  const recipients = (message.to ?? []).filter(recipient => !!recipient?.email);
  if (recipients.length === 0) {
    return null;
  } else {
    const first = recipients[0];
    const extra = recipients.length > 1 ? ` +${recipients.length - 1}` : "";
    return {name: `${first.name || first.email}${extra}`, email: first.email};
  }
}
