import type {
  AssistantDeliveryPlan,
  AssistantNotification,
  InteractionActivityState
} from "@agent/shared-types";

function hasActiveSpeech(state: InteractionActivityState): boolean {
  return state.userSpeaking || state.assistantSpeaking;
}

export function planAssistantNotificationDelivery(
  notification: AssistantNotification,
  state: InteractionActivityState
): AssistantDeliveryPlan {
  if (notification.reason === "task_failed") {
    return {
      uiText: notification.message.text,
      speechText: notification.message.text,
      reason: notification.reason,
      taskId: notification.message.taskId,
      createdAt: notification.message.createdAt,
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "approval_required") {
    return {
      uiText: notification.message.text,
      speechText: notification.message.text,
      reason: notification.reason,
      taskId: notification.message.taskId,
      createdAt: notification.message.createdAt,
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "task_waiting_input") {
    return {
      uiText: notification.message.text,
      speechText: notification.message.text,
      reason: notification.reason,
      taskId: notification.message.taskId,
      createdAt: notification.message.createdAt,
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "task_completed") {
    if (hasActiveSpeech(state)) {
      return {
        uiText: notification.message.text,
        speechText: `좋아, 마무리됐어. ${notification.message.text}`,
        reason: notification.reason,
        taskId: notification.message.taskId,
        createdAt: notification.message.createdAt,
        delivery: "next_turn"
      };
    }

    return {
      uiText: notification.message.text,
      speechText: `짧게 보고할게. ${notification.message.text}`,
      reason: notification.reason,
      taskId: notification.message.taskId,
      createdAt: notification.message.createdAt,
      delivery: "immediate"
    };
  }

  return {
    uiText: notification.message.text,
    speechText: notification.message.text,
    reason: notification.reason,
    taskId: notification.message.taskId,
    createdAt: notification.message.createdAt,
    delivery: notification.delivery
  };
}
