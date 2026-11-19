import { meetingCaptureMessage, meetingCaptureMessageFrom, meetingRecordingMessage, meetingRecordingMessageFrom } from "./meeting-recording-message";

describe("meetingRecordingMessageFrom", () => {
  it("reads a recording message from the Jitsi endpoint event payload", () => {
    const payload = {senderInfo: {id: "abc"}, data: {eventData: {name: "endpoint-text-message", text: meetingRecordingMessage(true)}}};
    expect(meetingRecordingMessageFrom(payload)?.recording).toBe(true);
    expect(meetingRecordingMessageFrom({data: {text: meetingRecordingMessage(false)}})?.recording).toBe(false);
  });

  it("ignores other endpoint messages and malformed text", () => {
    expect(meetingRecordingMessageFrom({data: {eventData: {text: "hello"}}})).toBeNull();
    expect(meetingRecordingMessageFrom({data: {eventData: {text: JSON.stringify({name: "other", recording: true})}}})).toBeNull();
    expect(meetingRecordingMessageFrom({data: {eventData: {text: JSON.stringify({name: "ngx-meeting-recording", recording: "yes"})}}})).toBeNull();
    expect(meetingRecordingMessageFrom(null)).toBeNull();
  });
});

describe("meetingCaptureMessageFrom", () => {
  it("reads which participant is recording their own microphone", () => {
    const payload = {data: {eventData: {text: meetingCaptureMessage(true, "abc")}}};
    expect(meetingCaptureMessageFrom(payload)).toEqual({name: "ngx-meeting-capture", capturing: true, participantId: "abc"});
  });

  it("ignores recording messages and capture messages without a participant", () => {
    expect(meetingCaptureMessageFrom({data: {text: meetingRecordingMessage(true)}})).toBeNull();
    expect(meetingCaptureMessageFrom({data: {text: meetingCaptureMessage(true, "")}})).toBeNull();
    expect(meetingRecordingMessageFrom({data: {text: meetingCaptureMessage(true, "abc")}})).toBeNull();
  });
});
