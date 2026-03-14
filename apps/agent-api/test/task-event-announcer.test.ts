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
        title: "정리",
        normalizedGoal: "정리",
        status: "approval_required",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_approval_required",
        message: "이 파일들을 지워도 괜찮은지 확인해줘",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "이건 실행 전에 확인이 필요해. 이 파일들을 지워도 괜찮은지 확인해줘",
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
        title: "정리",
        normalizedGoal: "정리",
        status: "waiting_input",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:01.000Z"
      },
      event: {
        taskId: "task-1",
        type: "executor_waiting_input",
        message: "어느 폴더를 먼저 볼지 알려줘",
        createdAt: "2026-03-08T00:00:01.000Z"
      }
    });

    expect(notification).toEqual({
      message: {
        brainSessionId: "brain-1",
        speaker: "assistant",
        text: "이어가려면 답이 하나 더 필요해. 어느 폴더를 먼저 볼지 알려줘",
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
