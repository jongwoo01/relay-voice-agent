import { describe, expect, it, vi } from "vitest";
import { LiveVoiceSession } from "../src/main/live/live-voice-session.js";

describe("live-voice-session", () => {
  it("connects and updates state from transport events", async () => {
    let callbacks;
    const onUserTranscriptFinal = vi.fn(async () => undefined);
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const states = [];
    const audioChunks = [];
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal,
      onStateChange: async (state) => {
        states.push(state);
      },
      onAudioChunk: async (event) => {
        audioChunks.push(event);
      }
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_partial",
      text: "안녕"
    });
    await callbacks.onevent({
      type: "input_transcription_final",
      text: "안녕하세요"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "반가워요",
      finished: true
    });
    await callbacks.onevent({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });

    const state = await session.getState();
    expect(state.connected).toBe(true);
    expect(state.status).toBe("speaking");
    expect(state.lastUserTranscript).toBe("안녕하세요");
    expect(state.outputTranscript).toBe("");
    expect(state.liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: "안녕하세요",
          partial: false
        }),
        expect.objectContaining({
          role: "assistant",
          text: "반가워요",
          partial: false
        })
      ])
    );
    expect(state.metrics.connectedAt).toEqual(expect.any(String));
    expect(state.metrics.firstInputPartialAt).toEqual(expect.any(String));
    expect(state.metrics.firstInputFinalAt).toEqual(expect.any(String));
    expect(state.metrics.firstOutputTranscriptAt).toEqual(expect.any(String));
    expect(state.metrics.firstOutputAudioAt).toEqual(expect.any(String));
    expect(state.metrics.rawEvents.length).toBeGreaterThan(0);
    expect(onUserTranscriptFinal).toHaveBeenCalledWith("안녕하세요");
    expect(audioChunks).toContainEqual({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });
    expect(states.at(-1)?.outputTranscript).toBe("");
  });

  it("marks assistant output as interrupted when the live session reports interruption", async () => {
    let callbacks;
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "output_transcription",
      text: "좋아, 바로 해볼게",
      finished: false
    });
    await callbacks.onevent({
      type: "interrupted"
    });
    const interrupted = await session.getState();
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          text: "좋아, 바로 해볼게",
          status: "interrupted",
          partial: false
        }),
        expect.objectContaining({
          role: "system",
          status: "interrupted",
          text: "새 발화가 감지되어 응답을 멈췄습니다."
        })
      ])
    );
  });

  it("sends audio only while connected and unmuted", async () => {
    const sendRealtimeAudio = vi.fn();
    const sendText = vi.fn();
    const close = vi.fn();
    const connect = vi.fn(async () => ({
      sendText,
      sendRealtimeAudio,
      close
    }));
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    session.sendAudioChunk("AAAA");
    expect(sendRealtimeAudio).not.toHaveBeenCalled();

    await session.connect();
    await session.setMuted(true);
    session.sendAudioChunk("BBBB");
    expect(sendRealtimeAudio).not.toHaveBeenCalled();

    await session.setMuted(false);
    session.sendAudioChunk("CCCC", "audio/pcm;rate=16000");
    await session.sendText("hello");

    expect(sendRealtimeAudio).toHaveBeenCalledWith(
      "CCCC",
      "audio/pcm;rate=16000"
    );
    expect((await session.getState()).sentAudioChunkCount).toBe(1);
    expect(sendText).toHaveBeenCalledWith("hello", true);
    expect((await session.getState()).liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: "hello",
          partial: false
        })
      ])
    );

    await session.disconnect();
    expect(close).toHaveBeenCalled();
  });
});
