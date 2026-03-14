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
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
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

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({
                  name: "delegate_to_gemini_cli"
                })
              ])
            })
          ]
        })
      })
    );
    expect(connect.mock.calls[0][0].config.sessionResumption).toEqual({
      handle: undefined
    });
    expect(connect.mock.calls[0][0].config.contextWindowCompression).toEqual({
      triggerTokens: "24000"
    });
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
    expect(state.conversationTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user_message",
          speaker: "user",
          text: "안녕하세요",
          partial: false
        }),
        expect.objectContaining({
          kind: "assistant_message",
          speaker: "assistant",
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

  it("merges clipped english partial transcripts instead of dropping the prefix", async () => {
    let callbacks;
    const onUserTranscriptFinal = vi.fn(async () => undefined);
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal
    });

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_partial",
      text: "so wha"
    });
    await callbacks.onevent({
      type: "input_transcription_partial",
      text: "t are you hearing now?"
    });
    await callbacks.onevent({
      type: "input_transcription_final",
      text: "t are you hearing now?"
    });

    const state = await session.getState();
    expect(state.inputPartial).toBe("");
    expect(state.lastUserTranscript).toBe("so what are you hearing now?");
    expect(state.conversationTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user_message",
          speaker: "user",
          text: "so what are you hearing now?",
          partial: false
        })
      ])
    );
    expect(onUserTranscriptFinal).toHaveBeenCalledWith(
      "so what are you hearing now?",
      expect.any(Object)
    );
  });

  it("treats cumulative assistant partial transcripts as replacements instead of duplicate chunks", async () => {
    let callbacks;
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
    callbacks.onopen();
    await callbacks.onevent({
      type: "input_transcription_final",
      text: "hello"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "Hello, how can I help you today?",
      finished: false
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "Hello, how can I help you today? Thank you! Is there anything specific you'd like to do or know?",
      finished: false
    });

    const state = await session.getState();
    expect(state.outputTranscript).toBe(
      "Hello, how can I help you today? Thank you! Is there anything specific you'd like to do or know?"
    );
    expect(state.outputTranscript).not.toContain(
      "Hello, how can I help you today? Hello, how can I help you today?"
    );
  });

  it("does not carry assistant transcript across voice turns", async () => {
    let callbacks;
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
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
      type: "input_transcription_final",
      text: "hello"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "Hello, how can I help you today?",
      finished: false
    });
    await callbacks.onevent({
      type: "turn_complete"
    });
    await callbacks.onevent({
      type: "input_transcription_final",
      text: "so what are you hearing now?"
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "I'm not currently hearing any sounds at the moment.",
      finished: false
    });

    const state = await session.getState();
    const assistantMessages = state.conversationTimeline.filter(
      (item) => item.kind === "assistant_message" && item.speaker === "assistant"
    );
    expect(assistantMessages.at(-1)?.text).toBe(
      "I'm not currently hearing any sounds at the moment."
    );
    expect(assistantMessages.at(-1)?.text).not.toContain(
      "Hello, how can I help you today?"
    );
  });

  it("handles live tool calls through the provided callback", async () => {
    let callbacks;
    const sendToolResponse = vi.fn();
    const onToolCall = vi.fn(async (functionCalls) =>
      functionCalls.map((call) => ({
        id: call.id,
        name: call.name,
        response: {
          output: {
            accepted: true,
            status: "running",
            action: "created",
            message: "작업을 넘겼어요."
          }
        }
      }))
    );
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse,
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onToolCall
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "tool_call",
      functionCalls: [
        {
          id: "call-1",
          name: "delegate_to_gemini_cli",
          args: {
            request: "바탕화면 정리해줘"
          }
        }
      ]
    });

    expect(onToolCall).toHaveBeenCalledWith([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        args: {
          request: "바탕화면 정리해줘"
        }
      }
    ]);
    expect(sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        {
          id: "call-1",
          name: "delegate_to_gemini_cli",
          response: {
            output: {
              accepted: true,
              status: "running",
              action: "created",
              message: "작업을 넘겼어요."
            }
          }
        }
      ]
    });
  });

  it("claims runtime ownership for canonical tool presentations and suppresses later live output", async () => {
    let callbacks;
    const sendToolResponse = vi.fn();
    const onToolCall = vi.fn(async (functionCalls) =>
      functionCalls.map((call) => ({
        id: call.id,
        name: call.name,
        response: {
          output: {
            accepted: true,
            status: "running",
            action: "created",
            message: "Task is running",
            presentation: {
              ownership: "runtime",
              speechMode: "canonical",
              speechText:
                "작업을 시작했어요. 완료나 실패가 확인되면 바로 알려드릴게요.",
              allowLiveModelOutput: false,
            },
          },
        },
      })),
    );
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse,
        sendRealtimeAudio: vi.fn(),
        close: vi.fn(),
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onToolCall,
    });

    await session.connect();
    callbacks.onopen();
    await callbacks.onevent({
      type: "tool_call",
      functionCalls: [
        {
          id: "call-1",
          name: "delegate_to_gemini_cli",
          args: {
            request: "메일 보내줘",
          },
        },
      ],
    });
    await callbacks.onevent({
      type: "output_transcription",
      text: "I've sent it.",
      finished: false,
    });
    await callbacks.onevent({
      type: "output_audio",
      data: "QUJD",
      mimeType: "audio/pcm;rate=24000",
    });

    const state = await session.getState();
    expect(sendToolResponse).toHaveBeenCalledTimes(1);
    expect(state.liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          text: "작업을 시작했어요. 완료나 실패가 확인되면 바로 알려드릴게요.",
          partial: false,
          status: "task_ack",
        }),
      ]),
    );
    expect(state.liveMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "I've sent it.",
        }),
      ]),
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "runtime-owned tool presentation: canonical",
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output transcription",
    );
    expect(state.metrics.rawEvents.join("\n")).toContain(
      "suppressed live output audio",
    );
  });

  it("includes the delegate tool when a tool-friendly model is selected", async () => {
    const connect = vi.fn(async () => ({
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      close: vi.fn()
    }));
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    await session.connect({
      model: "gemini-2.5-flash-native-audio-preview-12-2025"
    });

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: expect.objectContaining({
          tools: [
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({
                  name: "delegate_to_gemini_cli"
                })
              ])
            })
          ]
        })
      })
    );
  });

  it("records live_error details and keeps the raw error message in state", async () => {
    let callbacks;
    const debugEvents = [];
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onDebugEvent: async (event) => {
        debugEvents.push(event);
      }
    });

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
    callbacks.onopen();
    await callbacks.onevent({
      type: "live_error",
      code: "INVALID_ARGUMENT",
      message: "unsupported setup",
      raw: {
        code: "INVALID_ARGUMENT",
        message: "unsupported setup"
      }
    });
    callbacks.onerror({
      code: "INVALID_ARGUMENT",
      message: "unsupported setup"
    });

    const state = await session.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("unsupported setup");
    expect(debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "live_error",
          detail: expect.stringContaining("unsupported setup")
        })
      ])
    );
  });

  it("marks assistant output as interrupted when the live session reports interruption", async () => {
    let callbacks;
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
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
        })
      ])
    );
    expect(interrupted.conversationTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assistant_message",
          text: "좋아, 바로 해볼게",
          interrupted: true
        })
      ])
    );
  });

  it("preserves the raw connect failure message in session state", async () => {
    const session = new LiveVoiceSession({
      transport: {
        connect: vi.fn(async () => {
          throw new Error("setup failed: unsupported tool config");
        })
      }
    });

    await expect(session.connect()).rejects.toThrow(
      "setup failed: unsupported tool config"
    );

    const state = await session.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("setup failed: unsupported tool config");
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
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect },
      onUserTranscriptFinal,
      onAudioChunk
    });

    await session.connect({ model: "gemini-live-2.5-flash-preview" });
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
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
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
    session.toolEnabled = false;
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
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
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
    session.toolEnabled = false;
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
        sendContext: vi.fn(),
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
    session.toolEnabled = false;
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
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
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

  it("keeps runtime context local-only for tool-enabled voice sessions", async () => {
    let callbacks;
    const sendContext = vi.fn();
    const connect = vi.fn(async (input) => {
      callbacks = input.callbacks;
      return {
        sendText: vi.fn(),
        sendContext,
        sendToolResponse: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        close: vi.fn()
      };
    });
    const session = new LiveVoiceSession({
      transport: { connect }
    });

    await session.connect();
    callbacks.onopen();
    await session.syncRuntimeContext(
      'Runtime status: task "브라우저 정리" is still running.',
      { guardActive: true }
    );
    await callbacks.onevent({
      type: "session_resumption_update",
      newHandle: "resume-123",
      resumable: true,
      lastConsumedClientMessageIndex: "9"
    });
    await session.disconnect();
    await session.connect({ model: "gemini-live-2.5-flash-preview" });

    expect(sendContext).not.toHaveBeenCalled();
    expect(connect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        })
      })
    );
    expect(connect.mock.calls.at(-1)[0].config.sessionResumption).toEqual({
      handle: "resume-123"
    });
    expect(connect.mock.calls.at(-1)[0].config.contextWindowCompression).toEqual({
      triggerTokens: "24000"
    });
    const state = await session.getState();
    expect(state.runtimeGuardActive).toBe(true);
    expect(state.runtimeContext).toContain('task "브라우저 정리"');
    expect(state.sessionResumption).toEqual({
      resumable: true,
      handle: "resume-123",
      lastConsumedClientMessageIndex: "9"
    });
  });
});
