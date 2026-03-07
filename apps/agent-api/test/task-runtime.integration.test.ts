import { describe, expect, it } from "vitest";
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
});
