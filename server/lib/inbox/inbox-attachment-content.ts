import { objectBufferForKey, objectSizeForKey } from "../aws/aws-controllers";
import { contentTypeFrom } from "../aws/aws-utils";
import { meetingCalendarFile, meetingRoomFromAttachmentUrl } from "../calendar/calendar-controllers";
import { createErrorDebugLog } from "../shared/error-debug-log";
import { isMongoId } from "../../../projects/ngx-ramblers/src/app/services/mongo-utils";
import { InboxAttachment } from "../../../projects/ngx-ramblers/src/app/models/inbox.model";
import { storeInboxAttachmentBuffer } from "./inbox-attachment-store";

const errorDebugLog = createErrorDebugLog("inbox-attachment-content");

function isLinkedAttachment(key: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(key || "");
}

function meetingCalendarIdFromAttachmentUrl(url: string): string | null {
  const id = meetingRoomFromAttachmentUrl(url);
  return isMongoId(id) ? id : null;
}

export function inboxAttachmentContentAvailable(attachment: Pick<InboxAttachment, "s3Key">): boolean {
  const key = attachment.s3Key;
  return !!key && (!isLinkedAttachment(key) || !!meetingCalendarIdFromAttachmentUrl(key));
}

async function meetingCalendarBuffer(id: string): Promise<Buffer> {
  const file = await meetingCalendarFile(id);
  if (file) {
    return Buffer.from(file.document, "utf8");
  } else {
    throw new Error("The meeting calendar attachment is unavailable");
  }
}

export async function inboxAttachmentBuffer(attachment: Pick<InboxAttachment, "s3Key">): Promise<Buffer> {
  const key = attachment.s3Key;
  if (!inboxAttachmentContentAvailable(attachment)) {
    throw new Error("Attachment content is unavailable");
  } else if (isLinkedAttachment(key)) {
    return meetingCalendarBuffer(meetingCalendarIdFromAttachmentUrl(key));
  } else {
    return objectBufferForKey(key);
  }
}

async function storedCopyOfLinkedAttachment(attachment: InboxAttachment): Promise<InboxAttachment> {
  const id = meetingCalendarIdFromAttachmentUrl(attachment.s3Key);
  if (!id) {
    return {...attachment, s3Key: null};
  } else {
    try {
      const content = await meetingCalendarBuffer(id);
      const stored = await storeInboxAttachmentBuffer(attachment.filename, contentTypeFrom("meeting.ics"), content, attachment.contentId);
      return stored.s3Key ? stored : attachment;
    } catch (error) {
      errorDebugLog("sent copy attachment could not be stored:", attachment.filename, (error as Error).message);
      return attachment;
    }
  }
}

export async function inboxAttachmentsStoredForSentCopy(attachments: InboxAttachment[]): Promise<InboxAttachment[]> {
  return Promise.all((attachments ?? []).map(attachment => isLinkedAttachment(attachment.s3Key)
    ? storedCopyOfLinkedAttachment(attachment)
    : Promise.resolve(attachment)));
}

export async function inboxAttachmentSize(attachment: Pick<InboxAttachment, "s3Key" | "sizeBytes">): Promise<number> {
  if (attachment.sizeBytes > 0) {
    return attachment.sizeBytes;
  } else if (isLinkedAttachment(attachment.s3Key)) {
    return (await inboxAttachmentBuffer(attachment)).length;
  } else {
    return objectSizeForKey(attachment.s3Key);
  }
}
