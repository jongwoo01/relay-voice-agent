import { describe, expect, it } from "vitest";
import type { LocalExecutor } from "@agent/local-executor-protocol";
import { TaskRuntime } from "../src/index.js";

class SilentExecutor implements LocalExecutor {
  async run(request: { task: { id: string }; now: string }) {
    return {
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed" as const,
        message: "Completed",
        createdAt: request.now
      }
    };
  }
}

describe("task-runtime contract", () => {
  it("accepts any executor that satisfies the local-executor protocol", async () => {
    const runtime = new TaskRuntime(new SilentExecutor());

    const result = await runtime.submit({
      text: "Clean up the folder",
      taskId: "task-2",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "task_created",
      "task_queued",
      "task_started",
      "executor_completed"
    ]);
  });
});
