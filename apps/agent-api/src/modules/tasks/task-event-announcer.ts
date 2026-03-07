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
  if (input.event.type === "executor_completed") {
    return {
      message: {
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: `작업이 끝났어. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt
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
        text: `작업이 중단되거나 실패했어. ${input.event.message}`,
        tone: "reply",
        createdAt: input.event.createdAt
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_failed"
    };
  }

  return null;
}
