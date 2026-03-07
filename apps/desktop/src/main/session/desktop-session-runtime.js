import {
  createDefaultIntentResolver,
  planAssistantNotificationDelivery,
  TextRealtimeSessionLoop
} from "@agent/agent-api";
import {
  createInitialMicState,
  toggleMicState
} from "../../shared/mic-state.js";
import {
  createInitialInteractionActivityState,
  createInitialNotificationCenterState,
  enqueueNotificationPlan,
  flushPendingNotificationPlans,
  setInteractionSpeaking
} from "../../shared/notification-center.js";
import { createLocalExecutionLayer } from "../execution/local-execution-layer.js";

export class DesktopSessionRuntime {
  constructor(options) {
    this.brainSessionId = options.brainSessionId;
    this.loop = options.loop;
    this.intentResolver = options.intentResolver;
    this.onStateChange = options.onStateChange;
    this.micState = options.micState ?? createInitialMicState();
    this.activityState =
      options.activityState ?? createInitialInteractionActivityState();
    this.notificationCenter =
      options.notificationCenter ?? createInitialNotificationCenterState();
  }

  static create(options = {}) {
    const brainSessionId = `desktop-session-${Date.now()}`;
    let runtime;
    const execution = createLocalExecutionLayer({
      mode: options.executionMode,
      onRawEvent: options.onRawExecutorEvent
    });

    const loop = new TextRealtimeSessionLoop(
      execution.executor,
      undefined,
      async (notification) => {
        if (runtime) {
          runtime.handleAssistantNotification(notification);
        }

        if (runtime && runtime.onStateChange) {
          await runtime.onStateChange(await runtime.collectState());
        }
      }
    );

    runtime = new DesktopSessionRuntime({
      brainSessionId,
      loop,
      intentResolver: createDefaultIntentResolver(),
      onStateChange: options.onStateChange
    });

    runtime.execution = execution;
    return runtime;
  }

  async collectState() {
    return {
      brainSessionId: this.brainSessionId,
      executionMode: this.execution.mode,
      mic: this.micState,
      activity: this.activityState,
      notifications: this.notificationCenter,
      messages: await this.loop.listConversation(this.brainSessionId),
      tasks: await this.loop.listActiveTasks(this.brainSessionId)
    };
  }

  async init() {
    return this.collectState();
  }

  async sendText(text) {
    const now = new Date().toISOString();
    const intent = await this.intentResolver.resolve(text);

    await this.loop.handleTurn({
      brainSessionId: this.brainSessionId,
      utterance: {
        text,
        intent,
        createdAt: now
      },
      now
    });

    return this.collectState();
  }

  async toggleMic() {
    this.micState = toggleMicState(this.micState);
    return this.publishState();
  }

  async setUserSpeaking(speaking) {
    this.activityState = setInteractionSpeaking(
      this.activityState,
      "user",
      speaking
    );
    this.notificationCenter = flushPendingNotificationPlans(
      this.notificationCenter,
      this.activityState
    );

    return this.publishState();
  }

  async setAssistantSpeaking(speaking) {
    this.activityState = setInteractionSpeaking(
      this.activityState,
      "assistant",
      speaking
    );
    this.notificationCenter = flushPendingNotificationPlans(
      this.notificationCenter,
      this.activityState
    );

    return this.publishState();
  }

  handleAssistantNotification(notification) {
    const plan = planAssistantNotificationDelivery(
      notification,
      this.activityState
    );

    this.notificationCenter = enqueueNotificationPlan(
      this.notificationCenter,
      plan
    );
    this.notificationCenter = flushPendingNotificationPlans(
      this.notificationCenter,
      this.activityState
    );
  }

  async publishState() {
    const state = await this.collectState();

    if (this.onStateChange) {
      await this.onStateChange(state);
    }

    return state;
  }
}
