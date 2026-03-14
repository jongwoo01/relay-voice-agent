import type {
  AssistantNotification,
  Task,
  TaskEvent
} from "@agent/shared-types";
import {
  appendEnglishOnlyDetail,
  englishOnlyText
} from "./english-only-text.js";

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
        text: appendEnglishOnlyDetail(
          "I need confirmation before I run this.",
          input.event.message
        ),
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
        text: appendEnglishOnlyDetail(
          "I need one more answer to continue.",
          input.event.message
        ),
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
        text: englishOnlyText(
          input.task.completionReport?.summary ?? input.event.message,
          "The task is done."
        ),
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
        text: appendEnglishOnlyDetail(
          "I hit a blocker here.",
          input.event.message
        ),
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
