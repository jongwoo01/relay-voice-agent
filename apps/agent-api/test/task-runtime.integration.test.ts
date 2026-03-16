import { describe, expect, it } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { ExecutorCancelledError } from "@agent/gemini-cli-runner";
import { TaskRuntime } from "../src/index.js";

describe("task-runtime", () => {
  it("runs a task through created, queued, progress, and completed events", async () => {
    const runtime = new TaskRuntime();

    const result = await runtime.submit({
      text: "Clean up the browser tabs",
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
        throw new Error("The task stopped because permission is required");
      }

      async cancel(): Promise<boolean> {
        return false;
      }
    }

    const runtime = new TaskRuntime(new FailingExecutor());

    const result = await runtime.submit({
      text: "Check the desktop folders",
      taskId: "task-2",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("failed");
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "executor_failed",
        message: "The task stopped because permission is required"
      })
    );
  });

  it("pauses a task when the executor needs more input", async () => {
    class WaitingInputExecutor implements LocalExecutor {
      async run(
        request: ExecutorRunRequest
      ): Promise<ExecutorRunResult> {
        return {
          progressEvents: [],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_waiting_input",
            message: "Tell me the exact date",
            createdAt: request.now
          },
          outcome: "waiting_input"
        };
      }

      async cancel(): Promise<boolean> {
        return false;
      }
    }

    const runtime = new TaskRuntime(new WaitingInputExecutor());

    const result = await runtime.submit({
      text: "Schedule it",
      taskId: "task-3",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("waiting_input");
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "executor_waiting_input",
        message: "Tell me the exact date"
      })
    );
  });

  it("marks the task cancelled when the executor is cancelled", async () => {
    class CancelledExecutor implements LocalExecutor {
      async run(): Promise<ExecutorRunResult> {
        throw new ExecutorCancelledError("Task execution cancelled");
      }

      async cancel(): Promise<boolean> {
        return true;
      }
    }

    const runtime = new TaskRuntime(new CancelledExecutor());
    const result = await runtime.submit({
      text: "Stop the task",
      taskId: "task-4",
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.task.status).toBe("cancelled");
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "executor_cancelled",
        message: "Task was cancelled by the user."
      })
    );
  });
});
