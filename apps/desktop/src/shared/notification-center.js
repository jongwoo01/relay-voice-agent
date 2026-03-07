export function createInitialInteractionActivityState() {
  return {
    userSpeaking: false,
    assistantSpeaking: false
  };
}

export function setInteractionSpeaking(state, actor, speaking) {
  if (actor === "user") {
    return {
      ...state,
      userSpeaking: speaking
    };
  }

  return {
    ...state,
    assistantSpeaking: speaking
  };
}

export function createInitialNotificationCenterState() {
  return {
    delivered: [],
    pending: []
  };
}

function hasActiveSpeech(activity) {
  return activity.userSpeaking || activity.assistantSpeaking;
}

export function enqueueNotificationPlan(center, plan) {
  if (plan.delivery === "immediate" || plan.delivery === "ui_only") {
    return {
      ...center,
      delivered: [...center.delivered, plan]
    };
  }

  return {
    ...center,
    pending: [...center.pending, plan]
  };
}

export function flushPendingNotificationPlans(center, activity) {
  if (hasActiveSpeech(activity) || center.pending.length === 0) {
    return center;
  }

  return {
    delivered: [...center.delivered, ...center.pending],
    pending: []
  };
}
