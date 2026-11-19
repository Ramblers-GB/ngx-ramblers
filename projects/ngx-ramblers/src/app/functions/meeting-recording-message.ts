import { isBoolean, isObject, isString } from "es-toolkit/compat";
import { MEETING_CAPTURE_MESSAGE, MEETING_RECORDING_MESSAGE, MeetingCaptureMessage, MeetingRecordingMessage } from "../models/video-meeting.model";

function recordOf(value: unknown): { [key: string]: unknown } {
  return isObject(value) ? value as { [key: string]: unknown } : {};
}

function endpointMessageText(payload: unknown): string {
  const record = recordOf(payload);
  const data = recordOf(record["data"]);
  const candidates = [recordOf(data["eventData"])["text"], recordOf(record["eventData"])["text"], data["text"]];
  return candidates.find(candidate => isString(candidate)) as string || "";
}

function parsedMessage(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function meetingRecordingMessage(recording: boolean): string {
  const message: MeetingRecordingMessage = {name: MEETING_RECORDING_MESSAGE, recording};
  return JSON.stringify(message);
}

export function meetingRecordingMessageFrom(payload: unknown): MeetingRecordingMessage | null {
  const parsed = recordOf(parsedMessage(endpointMessageText(payload)));
  if (parsed["name"] === MEETING_RECORDING_MESSAGE && isBoolean(parsed["recording"])) {
    return {name: MEETING_RECORDING_MESSAGE, recording: parsed["recording"]};
  } else {
    return null;
  }
}

export function meetingCaptureMessage(capturing: boolean, participantId: string): string {
  const message: MeetingCaptureMessage = {name: MEETING_CAPTURE_MESSAGE, capturing, participantId};
  return JSON.stringify(message);
}

export function meetingCaptureMessageFrom(payload: unknown): MeetingCaptureMessage | null {
  const parsed = recordOf(parsedMessage(endpointMessageText(payload)));
  if (parsed["name"] === MEETING_CAPTURE_MESSAGE && isBoolean(parsed["capturing"]) && isString(parsed["participantId"]) && parsed["participantId"]) {
    return {name: MEETING_CAPTURE_MESSAGE, capturing: parsed["capturing"], participantId: parsed["participantId"]};
  } else {
    return null;
  }
}
