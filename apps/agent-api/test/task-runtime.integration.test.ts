import { describe, expect, it } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { TaskRuntime } from "../src/index.js";

describe("task-runtime", () => {
  it("runs a task through created, queued, progress, and completed events", async () => {
    const runtime = new TaskRuntime();

    const result = await runtime.submit({
      text: "브라우저 탭 정리해줘",
      taskId: "task-1",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "task_created",
      "task_queued",
      "task_started",
      "executor_progress",
      "executor_progress",
      "executor_completed"
    ]);
  });

  it("marks the task failed when executor throws", async () => {
    class FailingExecutor implements LocalExecutor {
      async run(
        _request: ExecutorRunRequest
      ): Promise<ExecutorRunResult> {
        throw new Error("권한 요청으로 작업이 중단됐어");
      }
    }

    const runtime = new TaskRuntime(new FailingExecutor());

    const result = await runtime.submit({
      text: "바탕화면 폴더를 확인해줘",
      taskId: "task-2",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("failed");
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "executor_failed",
        message: "권한 요청으로 작업이 중단됐어"
      })
    );
  });
});
