import { describe, expect, it } from "vitest";
import type { AssistantNotification } from "@agent/shared-types";
import { planAssistantNotificationDelivery } from "../src/index.js";

function completedNotification(): AssistantNotification {
  return {
    message: {
      brainSessionId: "brain-1",
      speaker: "assistant",
      text: "Done. There are three folders on the desktop.",
      tone: "reply",
      createdAt: "2026-03-08T00:00:01.000Z"
    },
    priority: "normal",
    delivery: "next_turn",
    reason: "task_completed"
  };
}

describe("task-notification-policy", () => {
  it("reports completed tasks immediately when no one is speaking", () => {
    const plan = planAssistantNotificationDelivery(completedNotification(), {
      userSpeaking: false,
      assistantSpeaking: false
    });

    expect(plan).toEqual({
      uiText: "Done. There are three folders on the desktop.",
      speechText: "Done. There are three folders on the desktop.",
      delivery: "immediate",
      reason: "task_completed",
      taskId: undefined,
      createdAt: "2026-03-08T00:00:01.000Z"
    });
  });

  it("defers completed task speech to the next turn when speech is active", () => {
    const plan = planAssistantNotificationDelivery(completedNotification(), {
      userSpeaking: true,
      assistantSpeaking: false
    });

    expect(plan).toEqual({
      uiText: "Done. There are three folders on the desktop.",
      speechText: "Done. There are three folders on the desktop.",
      delivery: "next_turn",
      reason: "task_completed",
      taskId: undefined,
      createdAt: "2026-03-08T00:00:01.000Z"
    });
  });

  it("interrupts active speech for failed tasks", () => {
    const plan = planAssistantNotificationDelivery(
      {
        message: {
          brainSessionId: "brain-1",
          speaker: "assistant",
          text: "I hit a blocker here.",
          tone: "reply",
          createdAt: "2026-03-08T00:00:01.000Z"
        },
        priority: "high",
        delivery: "interrupt_if_speaking",
        reason: "task_failed"
      },
      {
        userSpeaking: false,
        assistantSpeaking: true
      }
    );

    expect(plan).toEqual({
      uiText: "I hit a blocker here.",
      speechText: "I hit a blocker here.",
      delivery: "interrupt_if_speaking",
      reason: "task_failed",
      taskId: undefined,
      createdAt: "2026-03-08T00:00:01.000Z"
    });
  });
});
