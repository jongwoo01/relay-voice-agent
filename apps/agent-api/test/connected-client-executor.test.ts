import { describe, expect, it, vi } from "vitest";
import { ConnectedClientExecutor } from "../src/server/connected-client-executor.js";

describe("ConnectedClientExecutor", () => {
  it("forwards a run request and resolves when the desktop worker completes", async () => {
    const sendRequest = vi.fn<
      (request: {
        runId: string;
        taskId: string;
        request: {
          task: {
            id: string;
          };
        };
      }) => Promise<void>
    >(async () => undefined);
    const executor = new ConnectedClientExecutor(sendRequest);

    const progressListener = vi.fn();
    const runPromise = executor.run(
      {
        task: {
          id: "task-1",
          title: "Hosted task",
          normalizedGoal: "hosted task",
          status: "queued",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        now: "2026-03-08T00:00:00.000Z",
        prompt: "Do the task"
      },
      progressListener
    );

    const hostedRequest = sendRequest.mock.calls[0]![0];
    expect(hostedRequest.taskId).toBe("task-1");

    await executor.recordProgress(hostedRequest.runId, {
      taskId: "task-1",
      type: "executor_progress",
      message: "running",
      createdAt: "2026-03-08T00:00:01.000Z"
    });

    executor.completeRun({
      runId: hostedRequest.runId,
      ok: true,
      result: {
        progressEvents: [],
        completionEvent: {
          taskId: "task-1",
          type: "executor_completed",
          message: "done",
          createdAt: "2026-03-08T00:00:02.000Z"
        },
        outcome: "completed",
        report: {
          summary: "done",
          verification: "verified",
          changes: []
        }
      }
    });

    await expect(runPromise).resolves.toEqual({
      progressEvents: [
        {
          taskId: "task-1",
          type: "executor_progress",
          message: "running",
          createdAt: "2026-03-08T00:00:01.000Z"
        }
      ],
      completionEvent: {
        taskId: "task-1",
        type: "executor_completed",
        message: "done",
        createdAt: "2026-03-08T00:00:02.000Z"
      },
      outcome: "completed",
      report: {
        summary: "done",
        verification: "verified",
        changes: []
      }
    });
    expect(progressListener).toHaveBeenCalledTimes(1);
  });

  it("rejects when the desktop worker reports a terminal error", async () => {
    const sendRequest = vi.fn<
      (request: {
        runId: string;
        taskId: string;
      }) => Promise<void>
    >(async () => undefined);
    const executor = new ConnectedClientExecutor(sendRequest);
    const runPromise = executor.run({
      task: {
        id: "task-2",
        title: "Failing task",
        normalizedGoal: "failing task",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Fail"
    });

    const hostedRequest = sendRequest.mock.calls[0]![0];
    executor.completeRun({
      runId: hostedRequest.runId,
      ok: false,
      error: "desktop disconnected"
    });

    await expect(runPromise).rejects.toThrow("desktop disconnected");
  });

  it("cancels a pending run by task id", async () => {
    const sendRequest = vi.fn(async () => undefined);
    const executor = new ConnectedClientExecutor(sendRequest);
    const runPromise = executor.run({
      task: {
        id: "task-cancel",
        title: "Cancelable task",
        normalizedGoal: "cancelable task",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Cancel me"
    });

    await expect(executor.cancel("task-cancel")).resolves.toBe(true);
    await expect(runPromise).rejects.toThrow("cancelled");
  });
});
