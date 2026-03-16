import { describe, expect, it, vi } from "vitest";
import type { ExecutorRunRequest, ExecutorRunResult, LocalExecutor } from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  BrainTurnService,
  InMemoryTaskExecutorSessionRepository,
  TaskExecutionService,
  TaskRuntime,
  type TaskRoutingDecision,
  type TaskRoutingResolver
} from "../src/index.js";

class CapturingExecutor implements LocalExecutor {
  public readonly run = vi.fn(
    async (
      request: ExecutorRunRequest
    ): Promise<ExecutorRunResult> => ({
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: "Execution completed",
        createdAt: request.now
      },
      sessionId: request.resumeSessionId ?? "session-created"
    })
  );

  public readonly cancel = vi.fn(async () => false);
}

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    ...(intent === "small_talk"
      ? { assistantReplyText: "Hello. Tell me what you need and I'll get started." }
      : {}),
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

describe("brain-turn-service", () => {
  it("returns a direct reply action for small talk", async () => {
    const service = new BrainTurnService();

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("hello", "small_talk"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "reply" });
    expect(result.replyText).toContain("Hello.");
  });

  it("returns a clarify action when the routing resolver requests clarification", async () => {
    const service = new BrainTurnService(
      new TaskExecutionService(),
      undefined,
      {
        resolve: async () =>
          createRoutingDecision({
            kind: "clarify",
            clarificationNeeded: true,
            clarificationText: "Tell me when it should happen one more time."
          })
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Schedule a meeting", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "clarify" });
    expect(result.replyText).toContain("when it should happen");
  });

  it("runs a new task when the utterance is a fresh task request", async () => {
    const executor = new CapturingExecutor();
    const service = new BrainTurnService(
      new TaskExecutionService(
        new TaskRuntime(executor),
        new InMemoryTaskExecutorSessionRepository()
      ),
      () => "task-new",
      {
        resolve: async () => createRoutingDecision()
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Clean up old browser tabs", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "create_task" });
    expect(result.task?.id).toBe("task-new");
    expect(result.task?.status).toBe("running");
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Clean up old browser tabs",
        resumeSessionId: undefined
      }),
      expect.any(Function)
    );
  });

  it("resumes an existing task when the utterance points to active work", async () => {
    const repository = new InMemoryTaskExecutorSessionRepository();
    await repository.save({
      taskId: "task-existing",
      sessionId: "session-existing",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });

    const executor = new CapturingExecutor();
    const service = new BrainTurnService(
      new TaskExecutionService(new TaskRuntime(executor), repository),
      undefined,
      {
        resolve: async () =>
          createRoutingDecision({
            kind: "continue_task",
            targetTaskId: "task-existing",
            executorPrompt: "Continue that task"
          })
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Continue that task", "task_request"),
      activeTasks: [
        {
          id: "task-existing",
          title: "Browser cleanup",
          normalizedGoal: "browser cleanup",
          status: "running",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        }
      ],
      now: "2026-03-08T00:01:00.000Z"
    });

    expect(result.action).toEqual({
      type: "resume_task",
      taskId: "task-existing"
    });
    expect(result.task?.status).toBe("running");
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: "session-existing",
        workingDirectory: "/tmp/browser"
      }),
      expect.any(Function)
    );
  });

  it("acknowledges completion-notice preference without creating a new task", async () => {
    const executor = new CapturingExecutor();
    const service = new BrainTurnService(
      new TaskExecutionService(
        new TaskRuntime(executor),
        new InMemoryTaskExecutorSessionRepository()
      ),
      undefined,
      {
        resolve: async () =>
          createRoutingDecision({
            kind: "set_completion_notification",
            targetTaskId: "task-existing"
          })
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Tell me when it finishes", "task_request"),
      activeTasks: [
        {
          id: "task-existing",
          title: "Browser cleanup",
          normalizedGoal: "browser cleanup",
          status: "running",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        }
      ],
      now: "2026-03-08T00:02:00.000Z"
    });

    expect(result.action).toEqual({
      type: "set_completion_notification",
      taskId: "task-existing"
    });
    expect(result.replyText).toContain("I'll let you know as soon as the current task finishes.");
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("returns an explicit error when routing fails instead of guessing", async () => {
    const service = new BrainTurnService(
      new TaskExecutionService(),
      undefined,
      {
        resolve: async () => {
          throw new Error("Vertex AI unavailable");
        }
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Continue it", "task_request"),
      activeTasks: [
        {
          id: "task-existing",
          title: "Browser cleanup",
          normalizedGoal: "browser cleanup",
          status: "running",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        }
      ],
      now: "2026-03-08T00:03:00.000Z"
    });

    expect(result.action.type).toBe("error");
    expect(result.replyText).toContain("Vertex AI");
  });
});
