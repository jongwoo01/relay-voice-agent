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
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "approval_required") {
    return {
      uiText: notification.message.text,
      speechText: notification.message.text,
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "task_waiting_input") {
    return {
      uiText: notification.message.text,
      speechText: notification.message.text,
      delivery: hasActiveSpeech(state)
        ? "interrupt_if_speaking"
        : "immediate"
    };
  }

  if (notification.reason === "task_completed") {
    if (hasActiveSpeech(state)) {
      return {
        uiText: notification.message.text,
        speechText: `오, 태스크가 완료됐네요. ${notification.message.text}`,
        delivery: "next_turn"
      };
    }

    return {
      uiText: notification.message.text,
      speechText: `보고드릴게요. ${notification.message.text}`,
      delivery: "immediate"
    };
  }

  return {
    uiText: notification.message.text,
    speechText: notification.message.text,
    delivery: notification.delivery
  };
}
