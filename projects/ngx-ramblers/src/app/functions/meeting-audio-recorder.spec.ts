import { describe, expect, it } from "vitest";
import { audioRms, createMeetingAudioRecorder, downsampleAudio, encodeWav, MEETING_AUDIO_HIGHPASS_HZ, MEETING_AUDIO_MIN_RMS } from "./meeting-audio-recorder";

describe("meeting audio signal chain", () => {

  it("keeps a high-pass so clothing rustle and rumble are cut before transcription", () => {
    expect(MEETING_AUDIO_HIGHPASS_HZ).toEqual(80);
  });

});

describe("audioRms", () => {

  it("is zero for silence and empty buffers", () => {
    expect(audioRms(new Float32Array(0))).toEqual(0);
    expect(audioRms(new Float32Array(16))).toEqual(0);
  });

  it("is above the speech floor for a loud tone", () => {
    const samples = Float32Array.from({length: 8}, () => 0.5);
    expect(audioRms(samples)).toBeGreaterThan(MEETING_AUDIO_MIN_RMS);
  });

  it("treats near-silent noise as below the speech floor", () => {
    const samples = Float32Array.from({length: 8}, () => 0.0001);
    expect(audioRms(samples)).toBeLessThan(MEETING_AUDIO_MIN_RMS);
  });

});

describe("downsampleAudio", () => {

  it("returns the original samples when the target rate is not lower", () => {
    const samples = Float32Array.from([0.25, 0.5, 0.75]);
    expect(Array.from(downsampleAudio(samples, 16000, 16000))).toEqual([0.25, 0.5, 0.75]);
  });

  it("shortens 48 kHz audio to 16 kHz", () => {
    const samples = Float32Array.from({length: 48}, (ignored, index) => index);
    expect(downsampleAudio(samples, 48000, 16000).length).toEqual(16);
  });

});

describe("encodeWav", () => {

  it("writes a wav blob", () => {
    const blob = encodeWav(Float32Array.from([0, 0.1, -0.1]), 16000);
    expect(blob.type).toEqual("audio/wav");
    expect(blob.size).toEqual(44 + 6);
  });

});

describe("createMeetingAudioRecorder while muted", () => {

  function fakeWindow() {
    const node = () => ({connect: () => undefined, disconnect: () => undefined});
    const audio = {processor: null as {onaudioprocess?: (event: unknown) => void; connect: () => void; disconnect: () => void} | null};
    class FakeAudioContext {
      state = "running";
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() { return node(); }
      createBiquadFilter() { return {...node(), type: "", frequency: {value: 0}}; }
      createScriptProcessor() { audio.processor = {...node()}; return audio.processor; }
      createGain() { return {...node(), gain: {value: 1}}; }
      close() { return Promise.resolve(); }
    }
    const win = {
      AudioContext: FakeAudioContext,
      navigator: {mediaDevices: {getUserMedia: () => Promise.resolve({getTracks: () => []})}},
      setInterval: () => 1,
      clearInterval: () => undefined
    } as unknown as Window;
    const speak = () => audio.processor.onaudioprocess({inputBuffer: {getChannelData: () => Float32Array.from({length: 4096}, (ignored, index) => Math.sin(index / 5) * 0.5)}});
    return {win, speak};
  }

  it("sends speech from before muting, and nothing said while muted", async () => {
    const {win, speak} = fakeWindow();
    const chunks: Blob[] = [];
    const recorder = createMeetingAudioRecorder(win, {chunkMs: 20000, echoCancellation: true, onChunk: blob => chunks.push(blob)});
    await recorder.start();
    speak();
    recorder.setPaused(true);
    expect(chunks.length).toEqual(1);
    speak();
    recorder.stop();
    expect(chunks.length).toEqual(1);
  });

  it("collects speech again after unmuting", async () => {
    const {win, speak} = fakeWindow();
    const chunks: Blob[] = [];
    const recorder = createMeetingAudioRecorder(win, {chunkMs: 20000, echoCancellation: true, onChunk: blob => chunks.push(blob)});
    recorder.setPaused(true);
    await recorder.start();
    speak();
    recorder.setPaused(false);
    speak();
    recorder.stop();
    expect(chunks.length).toEqual(1);
    expect(chunks[0].size).toEqual(44 + 4096 * 2);
  });
});
