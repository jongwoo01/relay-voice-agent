import { describe, expect, it, vi } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { TaskRuntime } from "../src/index.js";

class CapturingExecutor implements LocalExecutor {
  public readonly run = vi.fn(
    async (
      request: ExecutorRunRequest
    ): Promise<ExecutorRunResult> => ({
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: "이어받기 완료",
        createdAt: request.now
      },
      sessionId: request.resumeSessionId ?? "new-session-123"
    })
  );
}

describe("task-runtime resume session", () => {
  it("passes resumeSessionId and workingDirectory to the executor and preserves the session", async () => {
    const executor = new CapturingExecutor();
    const runtime = new TaskRuntime(executor);

    const result = await runtime.submit({
      text: "아까 하던 브라우저 정리 이어서 해",
      taskId: "task-3",
      now: "2026-03-08T00:00:00.000Z",
      executorSession: {
        taskId: "task-3",
        sessionId: "session-999",
        workingDirectory: "/tmp/browser",
        updatedAt: "2026-03-07T23:59:00.000Z"
      }
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "아까 하던 브라우저 정리 이어서 해",
        resumeSessionId: "session-999",
        workingDirectory: "/tmp/browser"
      }),
      undefined
    );
    expect(result.executorSession).toEqual({
      taskId: "task-3",
      sessionId: "session-999",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });
  });

  it("captures a new session id from the executor for fresh tasks", async () => {
    const executor = new CapturingExecutor();
    const runtime = new TaskRuntime(executor);

    const result = await runtime.submit({
      text: "새로 정리 시작해",
      taskId: "task-4",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.executorSession).toEqual({
      taskId: "task-4",
      sessionId: "new-session-123",
      workingDirectory: undefined,
      updatedAt: "2026-03-08T00:00:00.000Z"
    });
  });
});
