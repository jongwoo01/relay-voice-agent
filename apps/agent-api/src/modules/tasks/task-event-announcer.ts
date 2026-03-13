import type {
  AssistantNotification,
  Task,
  TaskEvent
} from "@agent/shared-types";

export interface BuildAssistantFollowUpInput {
  brainSessionId: string;
  task: Task;
  event: TaskEvent;
}

export function buildAssistantFollowUpMessage(
  input: BuildAssistantFollowUpInput
): AssistantNotification | null {
  if (input.event.type === "executor_approval_required") {
    return {
      message: {
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: `이건 실행 전에 확인이 필요해. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt,
        taskId: input.task.id
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "approval_required"
    };
  }

  if (input.event.type === "executor_waiting_input") {
    return {
      message: {
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: `이어가려면 답이 하나 더 필요해. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt,
        taskId: input.task.id
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_waiting_input"
    };
  }

  if (input.event.type === "executor_completed") {
    return {
      message: {
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: `좋아, 끝냈어. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt,
        taskId: input.task.id
      },
      priority: "normal",
      delivery: "next_turn",
      reason: "task_completed"
    };
  }

  if (input.event.type === "executor_failed") {
    return {
      message: {
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: `앗, 여기서 막혔어. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt,
        taskId: input.task.id
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_failed"
    };
  }

  return null;
}
