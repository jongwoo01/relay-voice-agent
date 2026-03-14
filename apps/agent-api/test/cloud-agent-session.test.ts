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
});
