import { describe, expect, it } from "vitest";
import {
  completeTask,
  createTask,
  queueTask,
  reportTaskProgress
} from "../src/task-coordinator.js";

const now = "2026-03-08T00:00:00.000Z";

describe("task-coordinator", () => {
  it("creates a task with a normalized goal and creation event", () => {
    const result = createTask("Clean up the browser tabs", now, "task-1");

    expect(result.task.status).toBe("created");
    expect(result.task.normalizedGoal).toBe("clean up the browser tabs");
    expect(result.event.type).toBe("task_created");
  });

  it("queues and reports progress for a task", () => {
    const created = createTask("Clean up the browser tabs", now, "task-1");
    const queued = queueTask(created.task, now);
    const progress = reportTaskProgress(queued.task, now, "Checking the browser");

    expect(queued.task.status).toBe("queued");
    expect(progress.task.status).toBe("running");
    expect(progress.event.type).toBe("executor_progress");
  });

  it("completes a task after it has been queued", () => {
    const created = createTask("Clean up the browser tabs", now, "task-1");
    const queued = queueTask(created.task, now);
    const completed = completeTask(queued.task, now, "Finished cleaning up the tabs");

    expect(completed.task.status).toBe("completed");
    expect(completed.event.type).toBe("executor_completed");
  });
});
