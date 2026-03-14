import { describe, expect, it } from "vitest";
import { buildAssistantFollowUpMessage } from "../src/index.js";

describe("task-event-announcer", () => {
  it("marks completed tasks as next-turn normal-priority follow-ups", () => {
    const notification = buildAssistantFollowUpMessage({
      brainSessionId: "brain-1",
      task: {
        id: "task-1",
        title: "Cleanup",
        normalizedGoal: "cleanup",
        status: "completed",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_completed",
        message: "Cleanup completed",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "Cleanup completed",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z",
        taskId: "task-1"
      },
      priority: "normal",
      delivery: "next_turn",
      reason: "task_completed"
    });
  });

  it("marks failed tasks as interrupt-worthy high-priority follow-ups", () => {
    const notification = buildAssistantFollowUpMessage({
      brainSessionId: "brain-1",
      task: {
        id: "task-1",
        title: "Cleanup",
        normalizedGoal: "cleanup",
        status: "failed",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_failed",
        message: "Permission is required before continuing",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "I hit a blocker here. Permission is required before continuing",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z",
        taskId: "task-1"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_failed"
    });
  });

  it("maps approval-required events into approval briefings", () => {
    const notification = buildAssistantFollowUpMessage({
      brainSessionId: "brain-1",
      task: {
        id: "task-1",
        title: "Cleanup",
        normalizedGoal: "cleanup",
        status: "approval_required",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_approval_required",
        message: "Please confirm whether these files can be deleted",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "I need confirmation before I run this. Please confirm whether these files can be deleted",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z",
        taskId: "task-1"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "approval_required"
    });
  });

  it("maps waiting-input events into follow-up questions", () => {
    const notification = buildAssistantFollowUpMessage({
      brainSessionId: "brain-1",
      task: {
        id: "task-1",
        title: "Cleanup",
        normalizedGoal: "cleanup",
        status: "waiting_input",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_waiting_input",
        message: "Tell me which folder to inspect first",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "I need one more answer to continue. Tell me which folder to inspect first",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z",
        taskId: "task-1"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_waiting_input"
    });
  });
});
