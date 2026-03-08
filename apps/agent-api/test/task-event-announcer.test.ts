import { describe, expect, it } from "vitest";
import { buildAssistantFollowUpMessage } from "../src/index.js";

describe("task-event-announcer", () => {
  it("marks completed tasks as next-turn normal-priority follow-ups", () => {
    const notification = buildAssistantFollowUpMessage({
      brainSessionId: "brain-1",
      task: {
        id: "task-1",
        title: "정리",
        normalizedGoal: "정리",
        status: "completed",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_completed",
        message: "정리 완료",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "좋아, 끝냈어. 정리 완료",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z"
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
        title: "정리",
        normalizedGoal: "정리",
        status: "failed",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_failed",
        message: "권한 요청으로 중단됨",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "앗, 여기서 막혔어. 권한 요청으로 중단됨",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_failed"
    });
  });
});
