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
  TaskIntakeResolver,
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
    if (utterance.text.includes("continue") && activeTasks[0]) {
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

const scriptedTaskIntakeResolver: TaskIntakeResolver = {
  analyzeStart: async (text) => {
    switch (text) {
      case "Clean up only the old browser tabs":
      case "Summarize the desktop files by type":
        return { requiredSlots: [], filledSlots: {} };
      case "Schedule it":
        return { requiredSlots: ["time"], filledSlots: {} };
      case "Send the email":
        return { requiredSlots: ["target"], filledSlots: {} };
      case "Clean up the downloads folder files":
        return { requiredSlots: ["scope"], filledSlots: {} };
      default:
        return { requiredSlots: [], filledSlots: {} };
    }
  },
  analyzeUpdate: async (_session, text) => {
    switch (text) {
      case "to Minsu":
        return {
          resolution: "answer_current_intake",
          requiredSlots: ["target"],
          filledSlots: { target: "to Minsu" }
        };
      case "Schedule it":
        return {
          resolution: "replace_task",
          requiredSlots: ["time"],
          filledSlots: {}
        };
      case "Organize them by type":
        return {
          resolution: "answer_current_intake",
          requiredSlots: ["scope"],
          filledSlots: { scope: "Organize them by type" }
        };
      default:
        return {
          resolution: "answer_current_intake",
          requiredSlots: [],
          filledSlots: {}
        };
    }
  }
};

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
      utterance: utterance("hello", "small_talk"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("reply");
    const conversation = await loop.listConversation("brain-suppress");
    expect(conversation).toEqual([
      expect.objectContaining({
        speaker: "user",
        text: "hello"
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
          message: "Cleanup in progress",
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
                message: "Cleanup completed",
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
        taskIntakeResolver: scriptedTaskIntakeResolver,
        taskRoutingResolver: defaultTaskRoutingResolver
      }
    );

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("Clean up only the old browser tabs", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant).toEqual({
      text: "I'll start the task now. Progress will stay visible in the panel.",
      tone: "task_ack"
    });
    expect(firstTurn.task?.status).toBe("running");

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("Thanks", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant?.tone).toBe("reply");
    expect(secondTurn.assistant?.text).toContain("Tell me");

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
      expect.objectContaining({ type: "executor_progress", message: "Cleanup in progress" })
    ]);

    resolveExecution?.();
    await loop.waitForBackgroundWork();

    const activeTasksAfterCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksAfterCompletion).toHaveLength(0);

    const conversationAfterCompletion = await loop.listConversation("brain-1");
    expect(conversationAfterCompletion.map((message) => message.text)).toContain(
      "Cleanup completed"
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

    const loop = new TextRealtimeSessionLoop(new NoopExecutor(), undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver
    });

    const turn = await loop.handleTurn({
      brainSessionId: "brain-2",
      utterance: utterance("Schedule it", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("clarify");
    expect(turn.assistant.text).toContain("when it should happen");
    await expect(loop.listActiveTasks("brain-2")).resolves.toEqual([]);
    await expect(loop.getActiveTaskIntake("brain-2")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "Schedule it",
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
            message: "Sent it",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver,
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-3",
      utterance: utterance("Send the email", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("clarify");

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-3",
      utterance: utterance("to Minsu", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe("Send the email to Minsu");
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
            clarificationText: "What task should I understand this as?"
        })
    };

    const loop = new TextRealtimeSessionLoop(new NoopExecutor(), undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver,
      taskRoutingResolver: clarifyingResolver
    });

    await loop.handleTurn({
      brainSessionId: "brain-3b",
      utterance: utterance("Send the email", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-3b",
      utterance: utterance("to Minsu", "small_talk"),
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

    const loop = new TextRealtimeSessionLoop(new NoopExecutor(), undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver
    });

    await loop.handleTurn({
      brainSessionId: "brain-4",
      utterance: utterance("Send the email", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    const replacementTurn = await loop.handleTurn({
      brainSessionId: "brain-4",
      utterance: utterance("Schedule it", "task_request"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(replacementTurn.assistant.tone).toBe("clarify");
    expect(replacementTurn.assistant.text).toContain("when it should happen");
    await expect(loop.getActiveTaskIntake("brain-4")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "Schedule it",
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
            message: "Desktop file summary completed",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver,
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const turn = await loop.handleTurn({
      brainSessionId: "brain-5",
      utterance: utterance("Summarize the desktop files by type", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(turn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe("Summarize the desktop files by type");
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
            message: "Downloads folder cleanup completed",
            createdAt: request.now
          }
        };
      }
    }

    const executor = new CapturingExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver,
      taskRoutingResolver: defaultTaskRoutingResolver
    });

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-6",
      utterance: utterance("Clean up the downloads folder files", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("clarify");
    expect(firstTurn.assistant.text).toContain("what rule or scope to use");
    await expect(loop.getActiveTaskIntake("brain-6")).resolves.toEqual(
      expect.objectContaining({
        sourceText: "Clean up the downloads folder files",
        missingSlots: ["scope"]
      })
    );

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-6",
      utterance: utterance("Organize them by type", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("task_ack");
    expect(executor.lastPrompt).toBe(
      "Clean up the downloads folder files Organize them by type"
    );
    await expect(loop.getActiveTaskIntake("brain-6")).resolves.toBeNull();
  });
});
