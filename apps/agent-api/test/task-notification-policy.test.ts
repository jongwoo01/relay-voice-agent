import { describe, expect, it } from "vitest";
import type { AssistantNotification } from "@agent/shared-types";
import { planAssistantNotificationDelivery } from "../src/index.js";

function completedNotification(): AssistantNotification {
  return {
    message: {
      brainSessionId: "brain-1",
      speaker: "assistant",
      text: "작업이 끝났어. 바탕화면에는 3개의 폴더가 있어.",
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
      uiText: "작업이 끝났어. 바탕화면에는 3개의 폴더가 있어.",
      speechText: "보고드릴게요. 작업이 끝났어. 바탕화면에는 3개의 폴더가 있어.",
      delivery: "immediate"
    });
  });

  it("defers completed task speech to the next turn when speech is active", () => {
    const plan = planAssistantNotificationDelivery(completedNotification(), {
      userSpeaking: true,
      assistantSpeaking: false
    });

    expect(plan).toEqual({
      uiText: "작업이 끝났어. 바탕화면에는 3개의 폴더가 있어.",
      speechText: "오, 태스크가 완료됐네요. 작업이 끝났어. 바탕화면에는 3개의 폴더가 있어.",
      delivery: "next_turn"
    });
  });

  it("interrupts active speech for failed tasks", () => {
    const plan = planAssistantNotificationDelivery(
      {
        message: {
          brainSessionId: "brain-1",
          speaker: "assistant",
          text: "작업이 중단되거나 실패했어. 권한이 필요해.",
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
      uiText: "작업이 중단되거나 실패했어. 권한이 필요해.",
      speechText: "작업이 중단되거나 실패했어. 권한이 필요해.",
      delivery: "interrupt_if_speaking"
    });
  });
});
