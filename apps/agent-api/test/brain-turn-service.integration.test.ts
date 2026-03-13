import { describe, expect, it, vi } from "vitest";
import type { ExecutorRunRequest, ExecutorRunResult, LocalExecutor } from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  BrainTurnService,
  ConversationOrchestrator,
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
        message: "실행 완료",
        createdAt: request.now
      },
      sessionId: request.resumeSessionId ?? "session-created"
    })
  );
}

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

describe("brain-turn-service", () => {
  it("returns a direct reply action for small talk", async () => {
    const service = new BrainTurnService();

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("안녕", "small_talk"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "reply" });
    expect(result.replyText).toContain("안녕하세요");
  });

  it("returns a clarify action when the routing resolver requests clarification", async () => {
    const service = new BrainTurnService(
      new ConversationOrchestrator(),
      new TaskExecutionService(),
      undefined,
      {
        resolve: async () =>
          createRoutingDecision({
            kind: "clarify",
            clarificationNeeded: true,
            clarificationText: "언제 할지 한 번만 더 알려줘."
          })
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("일정 잡아줘", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "clarify" });
    expect(result.replyText).toContain("언제 할지");
  });

  it("runs a new task when the utterance is a fresh task request", async () => {
    const executor = new CapturingExecutor();
    const service = new BrainTurnService(
      new ConversationOrchestrator(),
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
      utterance: utterance("브라우저 탭에서 오래된 탭만 정리해줘", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({ type: "create_task" });
    expect(result.task?.id).toBe("task-new");
    expect(result.task?.status).toBe("running");
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "브라우저 탭에서 오래된 탭만 정리해줘",
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
      new ConversationOrchestrator(),
      new TaskExecutionService(new TaskRuntime(executor), repository),
      undefined,
      {
        resolve: async () =>
          createRoutingDecision({
            kind: "continue_task",
            targetTaskId: "task-existing",
            executorPrompt: "아까 하던 거 이어서 해"
          })
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("아까 하던 거 이어서 해", "task_request"),
      activeTasks: [
        {
          id: "task-existing",
          title: "브라우저 정리",
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
      new ConversationOrchestrator(),
      new TaskExecutionService(
        new TaskRuntime(executor),
        new InMemoryTaskExecutorSessionRepository()
      ),
      undefined,
      {
        resolve: async () => createRoutingDecision()
      } satisfies TaskRoutingResolver
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      utterance: utterance("완료되면 알려줘", "task_request"),
      activeTasks: [
        {
          id: "task-existing",
          title: "브라우저 정리",
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
    expect(result.replyText).toContain("끝나면 바로 알려드릴게요");
    expect(executor.run).not.toHaveBeenCalled();
  });
});
