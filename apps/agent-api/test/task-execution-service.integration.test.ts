import { describe, expect, it, vi } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import {
  InMemoryTaskExecutorSessionRepository,
  TaskExecutionService,
  TaskRuntime
} from "../src/index.js";

class CapturingExecutor implements LocalExecutor {
  public readonly run = vi.fn(
    async (request: ExecutorRunRequest): Promise<ExecutorRunResult> => ({
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: "완료",
        createdAt: request.now
      },
      sessionId: request.resumeSessionId ?? "session-new"
    })
  );
}

describe("task-execution-service", () => {
  it("loads an existing executor session and saves the updated session after execution", async () => {
    const repository = new InMemoryTaskExecutorSessionRepository();
    await repository.save({
      taskId: "task-1",
      sessionId: "session-existing",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });

    const executor = new CapturingExecutor();
    const service = new TaskExecutionService(
      new TaskRuntime(executor),
      repository
    );

    const result = await service.execute({
      taskId: "task-1",
      text: "아까 하던 거 이어서 해",
      now: "2026-03-08T00:01:00.000Z"
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: "session-existing",
        workingDirectory: "/tmp/browser"
      })
    );
    expect(result.executorSession).toEqual({
      taskId: "task-1",
      sessionId: "session-existing",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:01:00.000Z"
    });

    await expect(repository.getByTaskId("task-1")).resolves.toEqual({
      taskId: "task-1",
      sessionId: "session-existing",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:01:00.000Z"
    });
  });

  it("stores a newly issued executor session for fresh tasks", async () => {
    const repository = new InMemoryTaskExecutorSessionRepository();
    const executor = new CapturingExecutor();
    const service = new TaskExecutionService(
      new TaskRuntime(executor),
      repository
    );

    const result = await service.execute({
      taskId: "task-2",
      text: "새 작업 시작해",
      now: "2026-03-08T00:01:00.000Z"
    });

    expect(result.executorSession).toEqual({
      taskId: "task-2",
      sessionId: "session-new",
      workingDirectory: undefined,
      updatedAt: "2026-03-08T00:01:00.000Z"
    });

    await expect(repository.getByTaskId("task-2")).resolves.toEqual({
      taskId: "task-2",
      sessionId: "session-new",
      workingDirectory: undefined,
      updatedAt: "2026-03-08T00:01:00.000Z"
    });
  });
});
