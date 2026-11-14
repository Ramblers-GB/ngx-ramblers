import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import * as aws from "../aws/aws-controllers";
import * as calendar from "../calendar/calendar-controllers";
import { inboxAttachmentBuffer, inboxAttachmentContentAvailable, inboxAttachmentSize, inboxAttachmentsStoredForSentCopy } from "./inbox-attachment-content";

describe("inbox attachment content", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const calendarId = "0123456789abcdef01234567";
  const calendarPath = `/api/calendar/meeting/${calendarId}.ics`;
  const calendarAddress = `https://group.example.org.uk${calendarPath}`;
  const attachment = {filename: "meeting.ics", contentType: "application/octet-stream", sizeBytes: 0, s3Key: calendarAddress, contentId: null};
  const calendarFile = {document: "BEGIN:VCALENDAR", fileName: "meeting.ics"};

  it("rebuilds a legacy sent calendar attachment from the meeting record", async () => {
    const generate = sandbox.stub(calendar, "meetingCalendarFile").resolves(calendarFile);
    const fetched = sandbox.stub(globalThis, "fetch");
    const stored = sandbox.stub(aws, "objectBufferForKey");
    const content = await inboxAttachmentBuffer(attachment);
    expect(content.toString("utf8")).toEqual(calendarFile.document);
    expect(generate.calledOnceWithExactly(calendarId)).toBe(true);
    expect(fetched.called).toBe(false);
    expect(stored.called).toBe(false);
  });

  it("stores a relative meeting calendar link as an attachment for sent copies", async () => {
    const generate = sandbox.stub(calendar, "meetingCalendarFile").resolves(calendarFile);
    const upload = sandbox.stub(aws, "putBufferDirect").resolves({responseData: {}, information: "Stored"});
    const [stored] = await inboxAttachmentsStoredForSentCopy([{...attachment, s3Key: calendarPath}]);
    const [folder, filename, content, contentType] = upload.firstCall.args;

    expect(generate.calledOnceWithExactly(calendarId)).toBe(true);
    expect(upload.calledOnce).toBe(true);
    expect(content.toString("utf8")).toBe(calendarFile.document);
    expect(contentType).toBe("text/calendar; charset=utf-8");
    expect(stored).toEqual({...attachment, s3Key: `${folder}/${filename}`, sizeBytes: 15, contentType});
  });

  it("never fetches an arbitrary attachment URL", async () => {
    const fetched = sandbox.stub(globalThis, "fetch");
    const stored = sandbox.stub(aws, "objectBufferForKey");
    const generate = sandbox.stub(calendar, "meetingCalendarFile");
    const external = {...attachment, s3Key: "http://127.0.0.1/internal"};
    expect(inboxAttachmentContentAvailable(external)).toBe(false);
    expect(await inboxAttachmentsStoredForSentCopy([external])).toEqual([{...external, s3Key: null}]);
    await expect(inboxAttachmentBuffer(external)).rejects.toThrow("Attachment content is unavailable");
    expect(fetched.called || stored.called || generate.called).toBe(false);
  });

  it("reads a received attachment from file storage", async () => {
    sandbox.stub(aws, "objectBufferForKey").resolves(Buffer.from("stored", "utf8"));
    const content = await inboxAttachmentBuffer({s3Key: "inbox-attachments/meeting.ics"});
    expect(content.toString("utf8")).toEqual("stored");
  });

  it("reports an unavailable legacy attachment when the meeting is gone", async () => {
    sandbox.stub(calendar, "meetingCalendarFile").resolves(null);
    await expect(inboxAttachmentBuffer(attachment)).rejects.toThrow("The meeting calendar attachment is unavailable");
  });

  it("measures a generated calendar without a recorded size", async () => {
    const generate = sandbox.stub(calendar, "meetingCalendarFile").resolves(calendarFile);
    expect(await inboxAttachmentSize(attachment)).toEqual(15);
    expect(await inboxAttachmentSize({...attachment, sizeBytes: 509})).toEqual(509);
    expect(generate.calledOnce).toBe(true);
  });
});
