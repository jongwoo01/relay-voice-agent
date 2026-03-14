import { describe, expect, it, vi } from "vitest";
import {
  createInMemorySessionPersistence,
  type GoogleLiveApiTransportCallbacks,
  type SessionMemoryServiceLike
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

function createStubSessionMemoryService(
  initial?: Record<string, string>
): SessionMemoryServiceLike {
  const memory = new Map(Object.entries(initial ?? {}));

  return {
    async rememberFromUtterance({ brainSessionId, text }) {
      const normalized = text.trim().toLowerCase();
      if (!normalized.startsWith("call me ")) {
        return { updated: false, storedItems: [] };
      }

      const preferredName = text.trim().slice("call me ".length).trim();
      const summary = `Preferred name: ${preferredName}`;
      const updated = memory.get(brainSessionId) !== summary;
      if (updated) {
        memory.set(brainSessionId, summary);
      }

      return { updated, storedItems: [] };
    },
    async buildRuntimeContext(brainSessionId) {
      const summary = memory.get(brainSessionId);
      if (!summary) {
        return "";
      }

      return [
        "Session memory for this conversation only:",
        `- ${summary}`,
        "Use these notes only when relevant. Do not invent any extra profile details."
      ].join("\n");
    }
  };
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
      text: "Clean up the desktop"
    });

    expect(liveTransport.connect).toHaveBeenCalledTimes(1);
    expect(liveSession.sendText).toHaveBeenCalledWith("Clean up the desktop", true);
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
          lastUserTranscript: "Clean up the desktop",
          status: "thinking"
        })
      })
    );
  });

  it("marks the brain session closed when the session ends explicitly", async () => {
    const persistence = createInMemorySessionPersistence({
      ensureBrainSession: {
        brainSessionId: "brain-close",
        userId: "user-close",
        source: "live",
        now: "2026-03-14T00:00:00.000Z"
      }
    });
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
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-close",
        userId: "user-close",
        send: () => undefined
      },
      {
        createPersistence: async () => persistence,
        createLoop: async () => ({
          getActiveTaskIntake: async () => null,
          handleDelegateToGeminiCli: async () => {
            throw new Error("not needed");
          }
        }),
        liveTransport: {
          connect: vi.fn(async ({ callbacks }) => {
            callbacks?.onopen?.();
            return liveSession;
          })
        },
        now: () => "2026-03-14T00:10:00.000Z"
      }
    );

    await session.start();
    await session.close("user_hangup");

    await expect(
      persistence.brainSessionRepository.getById("brain-close")
    ).resolves.toEqual(
      expect.objectContaining({
        id: "brain-close",
        status: "closed",
        closedAt: "2026-03-14T00:10:00.000Z",
        updatedAt: "2026-03-14T00:10:00.000Z"
      })
    );
  });

  it("injects stored session memory into the live runtime context on startup", async () => {
    const sessionMemoryService = createStubSessionMemoryService({
      "brain-profile": "Preferred name: Jongwoo"
    });
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
        brainSessionId: "brain-profile",
        userId: "user-profile",
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
        sessionMemoryService,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();

    expect(liveSession.sendContext).toHaveBeenCalledWith(
      expect.stringContaining("Preferred name: Jongwoo")
    );
  });

  it("refreshes session memory only after the live turn reaches a safe point", async () => {
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
    const sessionMemoryService = createStubSessionMemoryService();
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-profile-update",
        userId: "user-profile-update",
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
        sessionMemoryService,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();
    liveSession.sendContext.mockClear();

    await session.handleClientEvent({
      type: "typed_turn",
      text: "Call me Jongwoo"
    });

    expect(liveSession.sendText).toHaveBeenCalledWith("Call me Jongwoo", true);
    expect(liveSession.sendContext).not.toHaveBeenCalledWith(
      expect.stringContaining("Preferred name: Jongwoo")
    );

    await liveCallbacks?.onevent?.({
      type: "turn_complete"
    });

    await waitFor(() =>
      liveSession.sendContext.mock.calls.some(([text]) =>
        String(text).includes("Preferred name: Jongwoo")
      )
    );
  });

  it("does not carry session memory into a different brain session", async () => {
    const sessionMemoryService = createStubSessionMemoryService({
      "brain-session-a": "Preferred name: Jongwoo"
    });
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
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-session-b",
        userId: "user-shared",
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
        liveTransport: {
          connect: vi.fn(async ({ callbacks }) => {
            callbacks?.onopen?.();
            return liveSession;
          })
        },
        sessionMemoryService,
        now: () => "2026-03-14T00:00:00.000Z"
      }
    );

    await session.start();

    expect(liveSession.sendContext).not.toHaveBeenCalledWith(
      expect.stringContaining("Preferred name: Jongwoo")
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

  it("reconnects with session resumption after goAway", async () => {
    const liveSessions = [
      {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        sendActivityStart: vi.fn(),
        sendActivityEnd: vi.fn(),
        sendAudioStreamEnd: vi.fn(),
        close: vi.fn()
      },
      {
        sendText: vi.fn(),
        sendContext: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeText: vi.fn(),
        sendRealtimeAudio: vi.fn(),
        sendActivityStart: vi.fn(),
        sendActivityEnd: vi.fn(),
        sendAudioStreamEnd: vi.fn(),
        close: vi.fn()
      }
    ];
    const liveCallbacks: GoogleLiveApiTransportCallbacks[] = [];
    const liveTransport = {
      connect: vi.fn(async ({ callbacks }) => {
        liveCallbacks.push(callbacks ?? {});
        callbacks?.onopen?.();
        return liveSessions[liveCallbacks.length - 1];
      })
    };
    const session = new CloudAgentSession(
      {
        brainSessionId: "brain-resume",
        userId: "user-resume",
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
    await liveCallbacks[0]?.onevent?.({
      type: "session_resumption_update",
      newHandle: "resume-handle-1",
      resumable: true
    });
    await liveCallbacks[0]?.onevent?.({
      type: "go_away",
      timeLeft: "5s"
    });

    expect(liveTransport.connect).toHaveBeenCalledTimes(2);
    expect(liveTransport.connect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        config: expect.objectContaining({
          sessionResumption: {
            handle: "resume-handle-1"
          }
        })
      })
    );
    expect(liveSessions[0].close).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh live session with empty sessionResumption config", async () => {
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
        brainSessionId: "brain-resume-fresh",
        userId: "user-resume-fresh",
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

    expect(liveTransport.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          sessionResumption: {}
        })
      })
    );
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
              title: "Desktop cleanup",
              normalizedGoal: "desktop cleanup",
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
            request: "Clean up the desktop"
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
        message: "Task is running",
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
          message: "Cleanup completed",
          createdAt: "2026-03-14T00:00:02.000Z"
        },
        outcome: "completed",
        report: {
          summary: "Finished cleaning up the desktop.",
          verification: "verified",
          changes: ["Removed unnecessary files"]
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
              summary: "Finished cleaning up the desktop."
            })
          }
        })
      ]
    });
    const taskStates = sentEvents.filter(
      (event): event is {
        type: "task_state";
        state: {
          avatar: { taskRunners: Array<Record<string, unknown>> };
          recentTasks: Array<Record<string, unknown>>;
          taskRunnerDetails: Array<Record<string, unknown>>;
        };
      } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_state"
    );

    expect(taskStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: expect.objectContaining({
            avatar: expect.objectContaining({
              taskRunners: expect.arrayContaining([
                expect.objectContaining({
                  taskId: "task-1",
                  status: "running",
                  statusLabel: "Running"
                })
              ])
            })
          })
        }),
        expect.objectContaining({
          state: expect.objectContaining({
            recentTasks: expect.arrayContaining([
              expect.objectContaining({
                id: "task-1",
                status: "completed"
              })
            ]),
            taskRunnerDetails: expect.arrayContaining([
              expect.objectContaining({
                taskId: "task-1",
                status: "completed",
                heroSummary: "Finished cleaning up the desktop.",
                resultSummary: "Finished cleaning up the desktop.",
                verification: "verified",
                changes: ["Removed unnecessary files"],
                timeline: expect.arrayContaining([
                  expect.objectContaining({
                    title: "Completion received"
                  }),
                  expect.objectContaining({
                    title: "Final summary"
                  })
                ])
              })
            ])
          })
        })
      ])
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
          speechText: "The task has started.",
          allowLiveModelOutput: false
        }
      }))
      .mockImplementationOnce(async () => ({
        action: "status" as const,
        accepted: true,
        taskId: "task-1",
        status: "completed" as const,
        message: "Checked the desktop items.",
        presentation: {
          ownership: "runtime" as const,
          speechMode: "grounded_summary" as const,
          speechText: "Checked the desktop items.",
          allowLiveModelOutput: false
        },
        summary: "Checked the desktop items."
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
            request: "Read the desktop contents"
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
      request: "Read the desktop contents",
      taskId: undefined,
      mode: undefined,
      now: "2026-03-14T00:00:00.000Z"
    });
    expect(handleDelegateToGeminiCli).toHaveBeenNthCalledWith(2, {
      brainSessionId: "brain-3",
      request: "status update",
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
