import { describe, expect, it } from "vitest";
import {
  buildTaskRunnerPresentation,
  buildConversationRoleLabel,
  buildDisplayConversationTimeline,
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
      nextSelectedTaskId: "task-2",
      shouldAutoOpenCompleted: false
    });
  });

  it("keeps a selected task open when it moves into archived failure", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: "task-1",
        taskRunners: [runner("task-2", "running")],
        archivedEntries: [runner("task-1", "failed")],
        previousTaskRunners: [runner("task-1", "running")],
        previousArchivedEntries: []
      })
    ).toEqual({
      nextSelectedTaskId: "task-1",
      shouldAutoOpenCompleted: false
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

  it("auto-selects a newly failed archived task when no active work remains", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: null,
        taskRunners: [],
        archivedEntries: [runner("task-failed", "failed")],
        previousTaskRunners: [runner("task-failed", "running")],
        previousArchivedEntries: []
      })
    ).toEqual({
      nextSelectedTaskId: "task-failed",
      shouldAutoOpenCompleted: false
    });
  });

  it("does not auto-select archived work when no active work remains", () => {
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
      nextSelectedTaskId: null,
      shouldAutoOpenCompleted: false
    });
  });

  it("preserves a manually opened archived task", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: "task-completed",
        taskRunners: [runner("task-running", "running")],
        archivedEntries: [runner("task-completed", "completed")]
      })
    ).toEqual({
      nextSelectedTaskId: "task-completed",
      shouldAutoOpenCompleted: false
    });
  });

  it("keeps active details closed after a manual dismiss until something new happens", () => {
    expect(
      resolveTaskPanelSelection({
        selectedTaskId: null,
        selectionDismissed: true,
        taskRunners: [runner("task-running", "running")],
        archivedEntries: [],
        previousTaskRunners: [runner("task-running", "running")],
        previousArchivedEntries: []
      })
    ).toEqual({
      nextSelectedTaskId: null,
      shouldAutoOpenCompleted: false
    });
  });

  it("keeps a cancelled handoff task visible in active entries until the dwell ends", () => {
    expect(
      buildTaskRunnerPresentation({
        taskRunners: [],
        archivedEntries: [runner("task-cancelled", "cancelled")],
        taskCancelUiState: {
          "task-cancelled": {
            phase: "cancelled_confirmed"
          }
        }
      })
    ).toEqual({
      activeEntries: [
        expect.objectContaining({
          taskId: "task-cancelled",
          status: "cancelled",
          cancelUiPhase: "cancelled_confirmed"
        })
      ],
      archivedEntries: []
    });
  });
});

describe("conversation timeline display", () => {
  it("keeps the transcript feed limited to assistant-side items", () => {
    const timeline = buildDisplayConversationTimeline({
      conversationTimeline: [
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "Checking in",
          partial: true,
          streaming: true,
          interrupted: false,
          createdAt: "2026-03-15T10:00:00.000Z",
          updatedAt: "2026-03-15T10:00:00.000Z"
        },
        {
          id: "turn-1:user-final",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "Check my desktop",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: "2026-03-15T10:00:01.000Z",
          updatedAt: "2026-03-15T10:00:01.000Z"
        },
        {
          id: "turn-1:assistant",
          turnId: "turn-1",
          kind: "assistant_message",
          inputMode: "voice",
          speaker: "assistant",
          text: "I'll check right away.",
          partial: false,
          streaming: false,
          interrupted: false,
          responseSource: "live",
          createdAt: "2026-03-15T10:00:02.000Z",
          updatedAt: "2026-03-15T10:00:02.000Z"
        }
      ],
      conversationTurns: [
        {
          turnId: "turn-1",
          inputMode: "voice",
          stage: "responding",
          startedAt: "2026-03-15T10:00:00.000Z",
          updatedAt: "2026-03-15T10:00:02.000Z"
        }
      ]
    });

    expect(timeline.map((item) => item.id)).toEqual(["turn-1:assistant"]);
  });

  it("keeps assistant and task events in stable order after user messages are removed", () => {
    const sharedTimestamp = "2026-03-15T10:00:00.000Z";
    const timeline = buildDisplayConversationTimeline({
      conversationTimeline: [
        {
          id: "turn-1:assistant",
          turnId: "turn-1",
          kind: "assistant_message",
          inputMode: "voice",
          speaker: "assistant",
          text: "Reply",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        },
        {
          id: "turn-1:task",
          turnId: "turn-1",
          kind: "task_event",
          inputMode: "voice",
          speaker: "system",
          text: "Waiting for input",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        },
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "User said this",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        }
      ],
      conversationTurns: [
        {
          turnId: "turn-1",
          inputMode: "voice",
          stage: "waiting_input",
          startedAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        }
      ]
    });

    expect(timeline.map((item) => item.id)).toEqual(["turn-1:assistant", "turn-1:task"]);
  });
});

describe("conversation role labels", () => {
  it("labels user messages distinctly from assistant and task events", () => {
    expect(
      buildConversationRoleLabel({
        speaker: "user",
        kind: "user_message"
      })
    ).toBe("you");
    expect(
      buildConversationRoleLabel({
        speaker: "assistant",
        kind: "assistant_message",
        responseSource: "live"
      })
    ).toBe("assistant · live");
    expect(
      buildConversationRoleLabel({
        speaker: "system",
        kind: "task_event"
      })
    ).toBe("task event");
  });
});
