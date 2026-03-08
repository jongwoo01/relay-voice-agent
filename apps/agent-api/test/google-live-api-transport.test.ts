import { describe, expect, it, vi } from "vitest";
import type { LiveServerMessage } from "@google/genai";
import { GoogleLiveApiTransport } from "../src/index.js";

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("google-live-api-transport", () => {
  it("turns partial and final input transcriptions into controller events", async () => {
    const events: unknown[] = [];
    let onmessage: ((message: LiveServerMessage) => void) | undefined;
    const connect = vi.fn(async (params) => {
      onmessage = params.callbacks.onmessage;
      return {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
      apiKey: "test-key",
      brainSessionId: "brain-1",
      callbacks: {
        onevent: async (event) => {
          events.push(event);
        }
      }
    });

    onmessage?.({
      serverContent: {
        inputTranscription: {
          text: "브라우저 탭",
          finished: false
        }
      }
    } as LiveServerMessage);

    onmessage?.({
      serverContent: {
        inputTranscription: {
          text: "브라우저 탭 정리해줘",
          finished: true
        }
      }
    } as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "raw_server_message",
        summary: expect.any(String)
      })
    );
    expect(events).toContainEqual({
      type: "input_transcription_partial",
      text: "브라우저 탭"
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "input_transcription_final",
        text: "브라우저 탭 정리해줘",
        turn: expect.objectContaining({
          assistant: {
            text: "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
            tone: "task_ack"
          }
        })
      })
    );
  });

  it("forwards model text and turn lifecycle events", async () => {
    const events: unknown[] = [];
    let onmessage: ((message: LiveServerMessage) => void) | undefined;
    const connect = vi.fn(async (params) => {
      onmessage = params.callbacks.onmessage;
      return {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
      apiKey: "test-key",
      brainSessionId: "brain-1",
      callbacks: {
        onevent: async (event) => {
          events.push(event);
        }
      }
    });

    onmessage?.({
      goAway: {
        timeLeft: "5s"
      },
      serverContent: {
        modelTurn: {
          role: "model",
          parts: [{ text: "안녕하세요" }]
        },
        outputTranscription: {
          text: "안녕하세요",
          finished: true
        },
        waitingForInput: true,
        turnComplete: true
      }
    } as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual({
      type: "model_text",
      text: "안녕하세요"
    });
    expect(events).toContainEqual({
      type: "output_transcription",
      text: "안녕하세요",
      finished: true
    });
    expect(events).toContainEqual({
      type: "go_away",
      timeLeft: "5s"
    });
    expect(events).toContainEqual({ type: "waiting_for_input" });
    expect(events).toContainEqual({ type: "turn_complete" });
  });

  it("forwards output audio chunks", async () => {
    const events: unknown[] = [];
    let onmessage: ((message: LiveServerMessage) => void) | undefined;
    const connect = vi.fn(async (params) => {
      onmessage = params.callbacks.onmessage;
      return {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
      apiKey: "test-key",
      brainSessionId: "brain-1",
      callbacks: {
        onevent: async (event) => {
          events.push(event);
        }
      }
    });

    onmessage?.({
      serverContent: {
        modelTurn: {
          role: "model",
          parts: [
            {
              inlineData: {
                data: "QUJD",
                mimeType: "audio/pcm;rate=24000"
              }
            }
          ]
        }
      }
    } as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000"
    });
  });

  it("sends text through the live session methods", async () => {
    const sendClientContent = vi.fn();
    const sendRealtimeInput = vi.fn();
    const close = vi.fn();
    const connect = vi.fn(async () => ({
      sendClientContent,
      sendRealtimeInput,
      close
    }));

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    const session = await transport.connect({
      apiKey: "test-key",
      brainSessionId: "brain-1"
    });

    session.sendText("안녕", false);
    session.sendRealtimeText("실시간 텍스트");
    session.sendRealtimeAudio("QUJD", "audio/pcm;rate=16000");
    session.close();

    expect(sendClientContent).toHaveBeenCalledWith({
      turns: [
        {
          role: "user",
          parts: [{ text: "안녕" }]
        }
      ],
      turnComplete: false
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      text: "실시간 텍스트"
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: "QUJD",
        mimeType: "audio/pcm;rate=16000"
      }
    });
    expect(close).toHaveBeenCalled();
  });
});
