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
    expect(onUserTranscriptFinal).toHaveBeenCalledWith(
      "안녕하세요",
      expect.objectContaining({
        routingHints: expect.arrayContaining(["안녕", "안녕하세요"]),
        routingHintText: expect.any(String)
      })
    );
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

  it("suppresses live output and injects runtime reply when a voice turn is claimed by runtime", async () => {
    let callbacks;
    const onAudioChunk = vi.fn(async () => undefined);
    const onUserTranscriptFinal = vi.fn(async () => ({
      mode: "runtime-first",
      assistant: {
        text: "좋아, 바로 확인해볼게.",
        tone: "task_ack"
      }
    }));
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal,
      onAudioChunk
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_final",
      text: "내 바탕화면에 뭐가 있니?"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "물론이죠! 바로 보여드릴게요.",
      finished: false
    });
    await callbacks.onevent({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });
    await callbacks.onevent({
      type: "turn_complete"
    });

    const state = await session.getState();
    expect(state.liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: "내 바탕화면에 뭐가 있니?",
          partial: false
        }),
        expect.objectContaining({
          role: "assistant",
          text: "좋아, 바로 확인해볼게.",
          partial: false,
          status: "task_ack"
        })
      ])
    );
    expect(state.liveMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "물론이죠! 바로 보여드릴게요."
        })
      ])
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output transcription"
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output audio"
    );
    expect(onAudioChunk).not.toHaveBeenCalled();
  });

  it("suppresses live output while a local-state voice turn is pending runtime routing", async () => {
    let callbacks;
    const onAudioChunk = vi.fn(async () => undefined);
    const onUserTranscriptFinal = vi.fn(async () => undefined);
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal,
      onAudioChunk
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_partial",
      text: "내 바탕화면에 무슨 폴더나 파일이"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "물론이죠! 바로 보여드릴게요.",
      finished: false
    });
    await callbacks.onevent({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });

    const state = await session.getState();
    expect(state.liveMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          text: "물론이죠! 바로 보여드릴게요."
        })
      ])
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output transcription (pending runtime route)"
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output audio (pending runtime route)"
    );
    expect(onAudioChunk).not.toHaveBeenCalled();
  });

  it("claims runtime-first from clipped syllable partials before live output escapes", async () => {
    let callbacks;
    const onAudioChunk = vi.fn(async () => undefined);
    const onUserTranscriptFinal = vi.fn(async () => ({
      mode: "runtime-first",
      assistant: {
        text: "좋아, 바로 확인해볼게.",
        tone: "task_ack"
      }
    }));
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal,
      onAudioChunk
    });

    await session.connect();
    callbacks.onopen();
    for (const fragment of [
      "탕",
      "화",
      "면",
      "에서",
      "파",
      "일",
      "이랑",
      "폴",
      "더",
      "개",
      "수",
      ",",
      "종",
      "류",
      "이름",
      "알려줘."
    ]) {
      await callbacks.onevent({
        type: "input_transcription_partial",
        text: fragment
      });
    }

    await callbacks.onevent({
      type: "output_transcription",
      text: "바탕 화면 상태를 확인해 볼게요.",
      finished: false
    });

    const state = await session.getState();
    expect(onUserTranscriptFinal).toHaveBeenCalledWith(
      "탕화면에서파일이랑폴더개수,종류이름알려줘.",
      expect.objectContaining({
        inferredFromPartial: true
      })
    );
    expect(state.liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          text: "좋아, 바로 확인해볼게.",
          status: "task_ack"
        })
      ])
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "runtime-first voice turn claimed"
    );
  });

  it("claims a runtime-first voice turn only once while output audio repeats", async () => {
    let callbacks;
    let resolveDecision;
    const onUserTranscriptFinal = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDecision = resolve;
        })
    );
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_partial",
      text: "내 바탕화면에 무슨 폴더나 파일이 있는지"
    });

    const firstOutput = callbacks.onevent({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });
    const secondOutput = callbacks.onevent({
      type: "output_audio",
      data: "REVG",
      mimeType: "audio/pcm;rate=24000"
    });

    resolveDecision({
      mode: "runtime-first",
      assistant: {
        text: "좋아, 바로 확인해볼게.",
        tone: "task_ack"
      }
    });

    await Promise.all([firstOutput, secondOutput]);

    const state = await session.getState();
    const injectedTaskAcks = state.liveMessages.filter(
      (message) =>
        message.role === "assistant" &&
        message.text === "좋아, 바로 확인해볼게."
    );

    expect(onUserTranscriptFinal).toHaveBeenCalledTimes(1);
    expect(injectedTaskAcks).toHaveLength(1);
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "runtime-first already in flight from output_audio"
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
