import { describe, expect, it } from "vitest";
import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type {
  AssistantNotification,
  FinalizedUtterance
} from "@agent/shared-types";
import { TextRealtimeSessionLoop } from "../src/index.js";
import type {
  TaskRoutingDecision,
  TaskRoutingResolver,
  TaskRoutingResolverInput
} from "../src/index.js";

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-08T00:00:00.000Z"
  };
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

const defaultTaskRoutingResolver = {
  resolve: async ({
    utterance,
    activeTasks
  }: TaskRoutingResolverInput): Promise<TaskRoutingDecision> => {
    if (utterance.text.includes("이어서") && activeTasks[0]) {
      return createRoutingDecision({
        kind:
          activeTasks[0].status === "waiting_input"
            ? "continue_blocked_task"
            : "continue_task",
        targetTaskId: activeTasks[0].id,
        executorPrompt: utterance.text
      });
    }

    return createRoutingDecision();
  }
} satisfies TaskRoutingResolver;

describe("text-realtime-session-loop", () => {
  it("can suppress direct assistant reply persistence for companion-style surfaces", async () => {
    class NoopExecutor implements LocalExecutor {
      async run(): Promise<ExecutorRunResult> {
        throw new Error("run should not be called for small talk");
      }
    }

    const loop = new TextRealtimeSessionLoop(
      new NoopExecutor(),
      undefined,
      undefined,
      {
        persistDirectAssistantReplies: false
      }
    );

    const turn = await loop.handleTurn({
      brainSessionId: "brain-suppress",
      utterance: utterance("안녕", "small_talk"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("reply");
    const conversation = await loop.listConversation("brain-suppress");
    expect(conversation).toEqual([
      expect.objectContaining({
        speaker: "user",
        text: "안녕"
      })
    ]);
  });

  it("accepts a second conversational turn while a task is running in the background", async () => {
    let resolveExecution: (() => void) | undefined;
    const notifications: AssistantNotification[] = [];

    class DeferredExecutor implements LocalExecutor {
      async run(
        request: ExecutorRunRequest,
        onProgress?: ExecutorProgressListener
      ): Promise<ExecutorRunResult> {
        const progressEvent = {
          taskId: request.task.id,
          type: "executor_progress" as const,
          message: "정리 중",
          createdAt: request.now
        };
        if (onProgress) {
          await onProgress(progressEvent);
        }

        return await new Promise<ExecutorRunResult>((resolve) => {
          resolveExecution = () =>
            resolve({
              progressEvents: [progressEvent],
              completionEvent: {
                taskId: request.task.id,
                type: "executor_completed",
                message: "정리 완료",
                createdAt: request.now
              },
              sessionId: request.resumeSessionId ?? "session-new"
            });
        });
      }
    }

    const loop = new TextRealtimeSessionLoop(
      new DeferredExecutor(),
      undefined,
      async (notification) => {
        notifications.push(notification);
      },
      {
        taskRoutingResolver: defaultTaskRoutingResolver
      }
    );

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("브라우저 탭에서 오래된 탭만 정리해줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant).toEqual({
      text: "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
      tone: "task_ack"
    });
    expect(firstTurn.task?.status).toBe("running");

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("고마워", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant?.tone).toBe("reply");
    expect(secondTurn.assistant?.text).toContain("구체적으로");

    const conversationBeforeCompletion = await loop.listConversation("brain-1");
    expect(conversationBeforeCompletion.map((message) => message.speaker)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);

    const activeTasksBeforeCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksBeforeCompletion).toHaveLength(1);
    expect(activeTasksBeforeCompletion[0]?.status).toBe("running");
    await expect(loop.listTaskEvents(firstTurn.task!.id)).resolves.toEqual([
      expect.objectContaining({ type: "task_created" }),
      expect.objectContaining({ type: "task_queued" }),
      expect.objectContaining({ type: "task_started" }),
      expect.objectContaining({ type: "executor_progress", message: "정리 중" })
    ]);

    resolveExecution?.();
    await loop.waitForBackgroundWork();

    const activeTasksAfterCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksAfterCompletion).toHaveLength(0);

    const conversationAfterCompletion = await loop.listConversation("brain-1");
    expect(conversationAfterCompletion.map((message) => message.text)).toContain(
      "좋아, 끝냈어. 정리 완료"
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        priority: "normal",
        delivery: "next_turn",
        reason: "task_completed"
      })
    ]);

    const taskEvents = await loop.listTaskEvents(firstTurn.task!.id);
    expect(taskEvents.map((event) => event.type)).toEqual([
      "task_created",
      "task_queued",
      "task_started",
      "executor_progress",
      "executor_completed"
    ]);
  });

  it("keeps task intake follow-ups conversational until required details are filled", async () => {
    class NoopExecutor implements LocalExecutor {
      async run(): Promise<ExecutorRunResult> {
        throw new Error("run should not be called for task intake clarify");
      }
    }

    const loop = new TextRealtimeSessionLoop(new NoopExecutor());

    const turn = await loop.handleTurn({
      brainSessionId: "brain-2",
      utterance: utterance("일정 잡아줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("clarify");
    expect(turn.assistant.text).toContain("언제 할지");
    await expect(loop.listActiveTasks("brain-2")).resolves.toEqual([]);
    await expect(loop.getActiveTaskIntake("brain-2")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "일정 잡아줘",
        missingSlots: ["time"]
      })
    );
  });

  it("merges a follow-up answer into the active intake and dispatches immediately", async () => {
    class CapturingExecutor implements LocalExecutor {
      public lastPrompt = "";

      async run(
        request: ExecutorRunRequest
      ): Promise<ExecutorRunResult> {
        this.lastPrompt = request.prompt;
        return {
          progressEvents: [],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_completed",
            message: "보냈어",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-3",
      utterance: utterance("메일 보내줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("clarify");

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-3",
      utterance: utterance("민수한테", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe("메일 보내줘 민수한테");
    await expect(loop.getActiveTaskIntake("brain-3")).resolves.toBeNull();
  });

  it("clears a ready intake even when downstream routing clarifies instead of creating a task", async () => {
    class NoopExecutor implements LocalExecutor {
      async run(): Promise<ExecutorRunResult> {
        throw new Error("run should not be called when routing clarifies");
      }
    }

    const clarifyingResolver: TaskRoutingResolver = {
      resolve: async (): Promise<TaskRoutingDecision> =>
        createRoutingDecision({
          kind: "clarify",
          clarificationNeeded: true,
          clarificationText: "어떤 작업으로 이해하면 될지 한 번만 더 짚어줘."
        })
    };

    const loop = new TextRealtimeSessionLoop(new NoopExecutor(), undefined, undefined, {
      taskRoutingResolver: clarifyingResolver
    });

    await loop.handleTurn({
      brainSessionId: "brain-3b",
      utterance: utterance("메일 보내줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-3b",
      utterance: utterance("민수한테", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("clarify");
    await expect(loop.getActiveTaskIntake("brain-3b")).resolves.toBeNull();
  });

  it("replaces an active intake when a new standalone task request arrives", async () => {
    class NoopExecutor implements LocalExecutor {
      async run(): Promise<ExecutorRunResult> {
        throw new Error("run should not be called for task intake clarify");
      }
    }

    const loop = new TextRealtimeSessionLoop(new NoopExecutor());

    await loop.handleTurn({
      brainSessionId: "brain-4",
      utterance: utterance("메일 보내줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    const replacementTurn = await loop.handleTurn({
      brainSessionId: "brain-4",
      utterance: utterance("일정 잡아줘", "task_request"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(replacementTurn.assistant.tone).toBe("clarify");
    expect(replacementTurn.assistant.text).toContain("언제 할지");
    await expect(loop.getActiveTaskIntake("brain-4")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "일정 잡아줘",
        missingSlots: ["time"]
      })
    );
  });

  it("runs a desktop file summary task immediately when the scope is already clear", async () => {
    class CapturingExecutor implements LocalExecutor {
      public lastPrompt = "";

      async run(
        request: ExecutorRunRequest
      ): Promise<ExecutorRunResult> {
        this.lastPrompt = request.prompt;
        return {
          progressEvents: [],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_completed",
            message: "바탕화면 파일 요약 완료",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const turn = await loop.handleTurn({
      brainSessionId: "brain-5",
      utterance: utterance("바탕화면 파일들을 종류별로 요약해줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe("바탕화면 파일들을 종류별로 요약해줘");
    await expect(loop.getActiveTaskIntake("brain-5")).resolves.toBeNull();
  });

  it("asks for an organizing rule before cleaning the downloads folder and runs once answered", async () => {
    class CapturingExecutor implements LocalExecutor {
      public lastPrompt = "";

      async run(
        request: ExecutorRunRequest
      ): Promise<ExecutorRunResult> {
        this.lastPrompt = request.prompt;
        return {
          progressEvents: [],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_completed",
            message: "다운로드 폴더 정리 완료",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-6",
      utterance: utterance("다운로드 폴더 파일 정리해줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("clarify");
    expect(firstTurn.assistant.text).toContain("어떤 기준으로");
    await expect(loop.getActiveTaskIntake("brain-6")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "다운로드 폴더 파일 정리해줘",
        missingSlots: ["scope"]
      })
    );

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-6",
      utterance: utterance("종류별로 정리해줘", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe(
      "다운로드 폴더 파일 정리해줘 종류별로 정리해줘"
    );
    await expect(loop.getActiveTaskIntake("brain-6")).resolves.toBeNull();
  });
});
