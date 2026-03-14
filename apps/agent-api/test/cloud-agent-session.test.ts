import { describe, expect, it, vi } from "vitest";
import {
  createInMemorySessionPersistence,
  type GoogleLiveApiTransportCallbacks
} from "../src/index.js";
import { CloudAgentSession } from "../src/server/cloud-agent-session.js";

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error("Timed out waiting for condition");
}

describe("CloudAgentSession", () => {
  it("forwards typed turns to the live transport after startup", async () => {
    const sentEvents: unknown[] = [];
    const liveSession = {
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeText: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      sendActivityStart: vi.fn(),
      sendActivityEnd: vi.fn(),
      sendAudioStreamEnd: vi.fn(),
      close: vi.fn()
    };
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        callbacks?.onopen?.();
        return liveSession;
      })
    };
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-1",
        userId: "user-1",
        send: (event) => {
          sentEvents.push(event);
        }
      },
      {
        createPersistence: async () => createInMemorySessionPersistence(),
        createLoop: async () => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli: async () => {
            throw new Error("not needed");
          }
        }),
        liveTransport,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    await session.handleClientEvent({
      type: "typed_turn",
      text: "데스크톱 정리해줘"
    });

    expect(liveTransport.connect).toHaveBeenCalledTimes(1);
    expect(liveSession.sendText).toHaveBeenCalledWith("데스크톱 정리해줘", true);
    expect(sentEvents).toContainEqual(
      expect.objectContaining({
        type: "session_ready",
        brainSessionId: "brain-1"
      })
    );
    expect(sentEvents).toContainEqual(
      expect.objectContaining({
        type: "conversation_state",
        state: expect.objectContaining({
          lastUserTranscript: "데스크톱 정리해줘",
          status: "thinking"
        })
      })
    );
  });

  it("ignores late audio events after the live session closes", async () => {
    const liveSession = {
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeText: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      sendActivityStart: vi.fn(),
      sendActivityEnd: vi.fn(),
      sendAudioStreamEnd: vi.fn(),
      close: vi.fn()
    };
    let liveCallbacks: GoogleLiveApiTransportCallbacks | undefined;
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        liveCallbacks = callbacks;
        callbacks?.onopen?.();
        return liveSession;
      })
    };
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-audio-close",
        userId: "user-audio-close",
        send: () => undefined
      },
      {
        createPersistence: async () => createInMemorySessionPersistence(),
        createLoop: async () => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli: async () => {
            throw new Error("not needed");
          }
        }),
        liveTransport,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    liveCallbacks?.onclose?.({ reason: "test close" });

    await expect(
      session.handleClientEvent({
        type: "audio_chunk",
        data: "AAAA",
        mimeType: "audio/pcm;rate=16000"
      })
    ).resolves.toBeUndefined();
    await expect(
      session.handleClientEvent({
        type: "audio_stream_end"
      })
    ).resolves.toBeUndefined();

    expect(liveSession.sendRealtimeAudio).not.toHaveBeenCalled();
    expect(liveSession.sendAudioStreamEnd).not.toHaveBeenCalled();
  });

  it("round-trips executor requests through the connected desktop worker", async () => {
    const sentEvents: unknown[] = [];
    const persistence = createInMemorySessionPersistence();
    const liveSession = {
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeText: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      sendActivityStart: vi.fn(),
      sendActivityEnd: vi.fn(),
      sendAudioStreamEnd: vi.fn(),
      close: vi.fn()
    };
    let liveCallbacks: GoogleLiveApiTransportCallbacks | undefined;
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        liveCallbacks = callbacks;
        callbacks?.onopen?.();
        return liveSession;
      })
    };
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-2",
        userId: "user-2",
        send: (event) => {
          sentEvents.push(event);
        }
      },
      {
        createPersistence: async () => persistence,
        createLoop: async ({ executor, persistence: injectedPersistence }) => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli: async ({ brainSessionId, request, now }) => {
            const task = {
              id: "task-1",
              title: "바탕화면 정리",
              normalizedGoal: "바탕화면 정리",
              status: "running" as const,
              createdAt: now,
              updatedAt: now
            };
            await injectedPersistence.taskRepository.save(brainSessionId, task);

            const result = await executor.run({
              task,
              now,
              prompt: request
            });

            const completedTask = {
              ...task,
              status: "completed" as const,
              updatedAt: now,
              completionReport: result.report
            };
            await injectedPersistence.taskRepository.save(brainSessionId, completedTask);
            await injectedPersistence.taskEventRepository.saveMany(task.id, [
              ...result.progressEvents,
              result.completionEvent
            ]);

            return {
              action: "created" as const,
              accepted: true,
              taskId: task.id,
              status: "completed" as const,
              message: result.completionEvent.message,
              presentation: {
                ownership: "runtime" as const,
                speechMode: "grounded_summary" as const,
                speechText: result.report?.summary ?? result.completionEvent.message,
                allowLiveModelOutput: false
              },
              summary: result.report?.summary,
              verification: result.report?.verification,
              changes: result.report?.changes
            };
          }
        }),
        liveTransport,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    expect(liveCallbacks?.onevent).toBeTypeOf("function");
    const toolCallPromise = liveCallbacks?.onevent?.({
      type: "tool_call",
      functionCalls: [
        {
          id: "tool-1",
          name: "delegate_to_gemini_cli",
          args: {
            request: "바탕화면 정리해줘"
          }
        }
      ]
    });
    await waitFor(() =>
      sentEvents.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "executor_request"
      )
    );

    const executorRequest = sentEvents.find(
      (event): event is { type: "executor_request"; request: { runId: string } } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "executor_request"
    );

    expect(executorRequest).toBeDefined();

    await session.handleClientEvent({
      type: "executor_progress",
      runId: executorRequest!.request.runId,
      taskId: "task-1",
      event: {
        taskId: "task-1",
        type: "executor_progress",
        message: "작업 중",
        createdAt: "2026-03-14T00:00:01.000Z"
      }
    });
    await session.handleClientEvent({
      type: "executor_terminal",
      runId: executorRequest!.request.runId,
      taskId: "task-1",
      ok: true,
      result: {
        progressEvents: [],
        completionEvent: {
          taskId: "task-1",
          type: "executor_completed",
          message: "정리 완료",
          createdAt: "2026-03-14T00:00:02.000Z"
        },
        outcome: "completed",
        report: {
          summary: "바탕화면 정리를 마쳤어요.",
          verification: "verified",
          changes: ["불필요한 파일을 정리함"]
        }
      }
    });
    await toolCallPromise;

    expect(liveSession.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        expect.objectContaining({
          id: "tool-1",
          name: "delegate_to_gemini_cli",
          scheduling: "SILENT",
          willContinue: false,
          response: {
            output: expect.objectContaining({
              accepted: true,
              taskId: "task-1",
              status: "completed",
              summary: "바탕화면 정리를 마쳤어요."
            })
          }
        })
      ]
    });
    expect(sentEvents).toContainEqual(
      expect.objectContaining({
        type: "task_state",
        state: expect.objectContaining({
          recentTasks: expect.arrayContaining([
            expect.objectContaining({
              id: "task-1",
              status: "completed"
            })
          ])
        })
      })
    );
  });

  it("uses silent scheduling for runtime-owned non-blocking tool calls and resolves follow-up call IDs back to tasks", async () => {
    const sentEvents: unknown[] = [];
    const liveSession = {
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeText: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      sendActivityStart: vi.fn(),
      sendActivityEnd: vi.fn(),
      sendAudioStreamEnd: vi.fn(),
      close: vi.fn()
    };
    let liveCallbacks: GoogleLiveApiTransportCallbacks | undefined;
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        liveCallbacks = callbacks;
        callbacks?.onopen?.();
        return liveSession;
      })
    };
    const handleDelegateToGeminiCli = vi
      .fn()
      .mockImplementationOnce(async () => ({
        action: "created" as const,
        accepted: true,
        taskId: "task-1",
        status: "running" as const,
        message: "Task is running",
        presentation: {
          ownership: "runtime" as const,
          speechMode: "canonical" as const,
          speechText: "작업을 시작했어요.",
          allowLiveModelOutput: false
        }
      }))
      .mockImplementationOnce(async () => ({
        action: "status" as const,
        accepted: true,
        taskId: "task-1",
        status: "completed" as const,
        message: "바탕화면 항목을 확인했어요.",
        presentation: {
          ownership: "runtime" as const,
          speechMode: "grounded_summary" as const,
          speechText: "바탕화면 항목을 확인했어요.",
          allowLiveModelOutput: false
        },
        summary: "바탕화면 항목을 확인했어요."
      }));
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-3",
        userId: "user-3",
        send: (event) => {
          sentEvents.push(event);
        }
      },
      {
        createPersistence: async () => createInMemorySessionPersistence(),
        createLoop: async () => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli
        }),
        liveTransport,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    await liveCallbacks?.onevent?.({
      type: "tool_call",
      functionCalls: [
        {
          id: "function-call-1",
          name: "delegate_to_gemini_cli",
          args: {
            request: "바탕화면 항목 읽어줘"
          }
        }
      ]
    });
    await liveCallbacks?.onevent?.({
      type: "tool_call",
      functionCalls: [
        {
          id: "function-call-2",
          name: "delegate_to_gemini_cli",
          args: {
            request: "check the status of function-call-1"
          }
        }
      ]
    });

    expect(handleDelegateToGeminiCli).toHaveBeenNthCalledWith(1, {
      brainSessionId: "brain-3",
      request: "바탕화면 항목 읽어줘",
      taskId: undefined,
      mode: undefined,
      now: "2026-03-14T00:00:00.000Z"
    });
    expect(handleDelegateToGeminiCli).toHaveBeenNthCalledWith(2, {
      brainSessionId: "brain-3",
      request: "상태 알려줘",
      taskId: "task-1",
      mode: "status",
      now: "2026-03-14T00:00:00.000Z"
    });
    expect(liveSession.sendToolResponse).toHaveBeenNthCalledWith(1, {
      functionResponses: [
        expect.objectContaining({
          id: "function-call-1",
          name: "delegate_to_gemini_cli",
          scheduling: "SILENT",
          willContinue: true
        })
      ]
    });
    expect(liveSession.sendToolResponse).toHaveBeenNthCalledWith(2, {
      functionResponses: [
        expect.objectContaining({
          id: "function-call-2",
          name: "delegate_to_gemini_cli",
          scheduling: "SILENT",
          willContinue: false,
          response: {
            output: expect.objectContaining({
              taskId: "task-1",
              status: "completed"
            })
          }
        })
      ]
    });
    expect(sentEvents).toContainEqual(
      expect.objectContaining({
        type: "conversation_state",
        state: expect.objectContaining({
          connected: true
        })
      })
    );
  });

  it("does not delegate unresolved internal function-call references to the desktop executor", async () => {
    const liveSession = {
      sendText: vi.fn(),
      sendContext: vi.fn(),
      sendToolResponse: vi.fn(),
      sendRealtimeText: vi.fn(),
      sendRealtimeAudio: vi.fn(),
      sendActivityStart: vi.fn(),
      sendActivityEnd: vi.fn(),
      sendAudioStreamEnd: vi.fn(),
      close: vi.fn()
    };
    let liveCallbacks: GoogleLiveApiTransportCallbacks | undefined;
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        liveCallbacks = callbacks;
        callbacks?.onopen?.();
        return liveSession;
      })
    };
    const handleDelegateToGeminiCli = vi.fn();
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-4",
        userId: "user-4",
        send: () => undefined
      },
      {
        createPersistence: async () => createInMemorySessionPersistence(),
        createLoop: async () => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli
        }),
        liveTransport,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    await liveCallbacks?.onevent?.({
      type: "tool_call",
      functionCalls: [
        {
          id: "function-call-9",
          name: "delegate_to_gemini_cli",
          args: {
            request: "get the results of function-call-does-not-exist"
          }
        }
      ]
    });

    expect(handleDelegateToGeminiCli).not.toHaveBeenCalled();
    expect(liveSession.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        {
          id: "function-call-9",
          name: "delegate_to_gemini_cli",
          response: {
            error:
              "Unknown internal function call reference: function-call-does-not-exist"
          },
          scheduling: "SILENT",
          willContinue: false
        }
      ]
    });
  });
});
