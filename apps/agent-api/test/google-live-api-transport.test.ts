import { describe, expect, it, vi } from "vitest";
import type { LiveServerMessage } from "@google/genai";
import {
  BrainTurnService,
  FinalizedUtteranceHandler,
  GoogleLiveApiTransport,
  LiveSessionController,
  LiveTranscriptAdapter,
  RealtimeGatewayService,
  type TaskRoutingDecision,
  type TaskRoutingResolver
} from "../src/index.js";

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createRoutingDecision(
  overrides: Partial<TaskRoutingDecision> = {}
): TaskRoutingDecision {
  return {
    kind: "create_task",
    targetTaskId: null,
    clarificationNeeded: false,
    clarificationText: null,
    executorPrompt: null,
    reason: "test routing decision",
    ...overrides
  };
}

describe("google-live-api-transport", () => {
  it("turns partial and final input transcriptions into controller events", async () => {
    const events: unknown[] = [];
    let onmessage: ((message: LiveServerMessage) => void) | undefined;
    const connect = vi.fn(async (params) => {
      onmessage = params.callbacks.onmessage;
      return {
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(
      new LiveSessionController(
        new LiveTranscriptAdapter(
          new RealtimeGatewayService(
            new FinalizedUtteranceHandler(
              new BrainTurnService(
                undefined,
                undefined,
                {
                  resolve: async () => createRoutingDecision()
                } satisfies TaskRoutingResolver
              )
            )
          ),
          {
            resolve: async (text) =>
              text.trim().toLowerCase() === "hello"
                ? {
                    intent: "small_talk" as const,
                    assistantReplyText:
                      "Hello. Tell me what you need and I'll get started."
                  }
                : { intent: "task_request" as const }
          }
        )
      ),
      () => ({
        live: { connect }
      })
    );

    await transport.connect({
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
          text: "Desktop files",
          finished: false
        }
      }
    } as unknown as LiveServerMessage);

    onmessage?.({
      serverContent: {
        inputTranscription: {
          text: "Organize the desktop files by type",
          finished: true
        }
      }
    } as unknown as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "raw_server_message",
        summary: expect.any(String)
      })
    );
    expect(events).toContainEqual({
      type: "input_transcription_partial",
      text: "Desktop files"
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "input_transcription_final",
        text: "Organize the desktop files by type",
        turn: expect.objectContaining({
          assistant: {
            text: "I'll start the task now. Progress will stay visible in the panel.",
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
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
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
          parts: [{ text: "hello" }]
        },
        outputTranscription: {
          text: "hello",
          finished: true
        },
        waitingForInput: true,
        turnComplete: true
      }
    } as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual({
      type: "model_text",
      text: "hello"
    });
    expect(events).toContainEqual({
      type: "output_transcription",
      text: "hello",
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
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
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

  it("emits live_error events with raw code and message", async () => {
    const events: unknown[] = [];
    let onerror:
      | ((event: { error?: { code?: string; message?: string } }) => void)
      | undefined;
    const connect = vi.fn(async (params) => {
      onerror = params.callbacks.onerror;
      return {
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
      brainSessionId: "brain-1",
      callbacks: {
        onevent: async (event) => {
          events.push(event);
        }
      }
    });

    onerror?.({
      error: {
        code: "INVALID_ARGUMENT",
        message: "unsupported setup"
      }
    });

    await flushAsyncWork();

    expect(events).toContainEqual({
      type: "live_error",
      code: "INVALID_ARGUMENT",
      message: "unsupported setup",
      raw: {
        code: "INVALID_ARGUMENT",
        message: "unsupported setup"
      }
    });
  });

  it("sends text through the live session methods", async () => {
    const sendClientContent = vi.fn();
    const sendToolResponse = vi.fn();
    const sendRealtimeInput = vi.fn();
    const close = vi.fn();
    const connect = vi.fn(async () => ({
      sendClientContent,
      sendToolResponse,
      sendRealtimeInput,
      close
    }));

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    const session = await transport.connect({
      brainSessionId: "brain-1"
    });

    session.sendText("hello", false);
    session.sendContext("Task is still running. Do not guess.");
    session.sendToolResponse({
      functionResponses: {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            accepted: true
          }
        }
      }
    });
    session.sendRealtimeText("realtime text");
    session.sendRealtimeAudio("QUJD", "audio/pcm;rate=16000");
    session.sendActivityStart();
    session.sendActivityEnd();
    session.sendAudioStreamEnd();
    session.close();

    expect(sendClientContent).toHaveBeenCalledWith({
      turns: [
        {
          role: "user",
          parts: [{ text: "hello" }]
        }
      ],
      turnComplete: false
    });
    expect(sendClientContent).toHaveBeenCalledWith({
      turns: [
        {
          role: "user",
          parts: [{ text: "[Runtime context]\nTask is still running. Do not guess." }]
        }
      ],
      turnComplete: false
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      text: "realtime text"
    });
    expect(sendToolResponse).toHaveBeenCalledWith({
      functionResponses: {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            accepted: true
          }
        }
      }
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: "QUJD",
        mimeType: "audio/pcm;rate=16000"
      }
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      activityStart: {}
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      activityEnd: {}
    });
    expect(sendRealtimeInput).toHaveBeenCalledWith({
      audioStreamEnd: true
    });
    expect(close).toHaveBeenCalled();
  });

  it("forwards tool calls and cancellation events", async () => {
    const events: unknown[] = [];
    let onmessage: ((message: LiveServerMessage) => void) | undefined;
    const connect = vi.fn(async (params) => {
      onmessage = params.callbacks.onmessage;
      return {
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn()
      };
    });

    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: { connect }
    }));

    await transport.connect({
      brainSessionId: "brain-1",
      callbacks: {
        onevent: async (event) => {
          events.push(event);
        }
      }
    });

    onmessage?.(({
      toolCall: {
        functionCalls: [
          {
            id: "call-1",
            name: "delegate_to_gemini_cli",
            args: {
              request: "Clean up the desktop"
            }
          }
        ]
      },
      toolCallCancellation: {
        ids: ["call-1"]
      }
    } as unknown) as LiveServerMessage);

    await flushAsyncWork();

    expect(events).toContainEqual({
      type: "tool_call",
      functionCalls: [
        {
          id: "call-1",
          name: "delegate_to_gemini_cli",
          args: {
            request: "Clean up the desktop"
          }
        }
      ]
    });
    expect(events).toContainEqual({
      type: "tool_call_cancellation",
      ids: ["call-1"]
    });
  });

  it("preserves the raw live connect message when connect fails", async () => {
    const transport = new GoogleLiveApiTransport(undefined, () => ({
      live: {
        connect: vi.fn(async () => {
          throw Object.assign(new Error("setup failed: unsupported tool config"), {
            code: "INVALID_ARGUMENT"
          });
        })
      }
    }));

    await expect(
      transport.connect({
        brainSessionId: "brain-1"
      })
    ).rejects.toThrow(
      "Gemini Live connection failed: setup failed: unsupported tool config"
    );
  });
});
