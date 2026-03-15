import { describe, expect, it } from "vitest";
import {
  pickDefaultTaskSelection,
  resolveTaskPanelSelection
} from "./ui-utils.js";

function runner(taskId: string, status: string, updatedAt = "2026-03-15T10:00:00.000Z") {
  return {
    taskId,
    status,
    headline: `Task ${taskId}`,
    latestHumanUpdate: `Update ${taskId}`,
    lastUpdatedAt: updatedAt
  };
}

describe("task panel selection", () => {
  it("auto-selects the first running task when tasks first appear", () => {
    const taskRunners = [
      runner("task-running", "running"),
      runner("task-queued", "queued", "2026-03-15T09:00:00.000Z")
    ];

    expect(pickDefaultTaskSelection(taskRunners, [])).toBe("task-running");
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: null,
        taskRunners,
        archivedEntries: []
      })
    ).toEqual({
      nextSelectedTaskId: "task-running",
      shouldAutoOpenCompleted: false
    });
  });

  it("keeps a selected running task open when it moves into completed", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: "task-1",
        taskRunners: [runner("task-2", "running")],
        archivedEntries: [runner("task-1", "completed")],
        previousTaskRunners: [runner("task-1", "running")],
        previousArchivedEntries: []
      })
    ).toEqual({
      nextSelectedTaskId: "task-1",
      shouldAutoOpenCompleted: true
    });
  });

  it("prefers a newly urgent active task over completed history", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: "task-completed",
        taskRunners: [runner("task-urgent", "waiting_input")],
        archivedEntries: [runner("task-completed", "completed")],
        previousTaskRunners: [runner("task-urgent", "running")],
        previousArchivedEntries: [runner("task-completed", "completed")]
      })
    ).toEqual({
      nextSelectedTaskId: "task-urgent",
      shouldAutoOpenCompleted: false
    });
  });

  it("auto-selects the latest completed task when no active work remains", () => {
    const archivedEntries = [
      runner("task-latest", "completed", "2026-03-15T10:00:00.000Z"),
      runner("task-older", "completed", "2026-03-15T08:00:00.000Z")
    ];

    expect(
      resolveTaskPanelSelection({
        selectedTaskId: null,
        taskRunners: [],
        archivedEntries
      })
    ).toEqual({
      nextSelectedTaskId: "task-latest",
      shouldAutoOpenCompleted: true
    });
  });
});
