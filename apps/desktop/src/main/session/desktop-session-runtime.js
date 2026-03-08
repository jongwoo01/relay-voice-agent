import {
  createDefaultIntentResolver,
  extractMemorySignals,
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

function createInitialInputState() {
  return {
    inFlight: false,
    queueSize: 0,
    activeText: null,
    lastSubmittedText: null,
    lastError: null
  };
}

function createInitialCanonicalTurnState() {
  return [];
}

function deriveMainAvatarState({
  activityState,
  inputState,
  intake,
  notificationCenter,
  memorySignals,
  tasks
}) {
  const latestDelivered = notificationCenter.delivered.at(-1);
  const hasBlockingTask = tasks.some(
    (task) =>
      task.status === "waiting_input" || task.status === "approval_required"
  );

  if (activityState.assistantSpeaking) {
    return "speaking";
  }

  if (activityState.userSpeaking) {
    return "listening";
  }

  if (hasBlockingTask) {
    return "waiting_user";
  }

  if (intake?.active && intake.missingSlots.length > 0) {
    return "waiting_user";
  }

  if (
    latestDelivered &&
    (latestDelivered.reason === "approval_required" ||
      latestDelivered.reason === "task_waiting_input")
  ) {
    return "waiting_user";
  }

  if (notificationCenter.pending.length > 0) {
    return "briefing";
  }

  if (inputState.inFlight) {
    return "thinking";
  }

  if (memorySignals.length > 0) {
    return "reflecting";
  }

  return "idle";
}

function buildSubAvatarViewModels(tasks, taskTimelines) {
  const latestEventByTaskId = new Map(
    taskTimelines.map((timeline) => [timeline.taskId, timeline.events.at(-1)])
  );

  return tasks.map((task, index) => {
    const latestEvent = latestEventByTaskId.get(task.id);
    return {
      taskId: task.id,
      label: `Worker ${index + 1}`,
      status: task.status,
      progressSummary: latestEvent?.message,
      blockingReason:
        task.status === "waiting_input" || task.status === "approval_required"
          ? latestEvent?.message
          : undefined
    };
  });
}

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
    this.inputState = options.inputState ?? createInitialInputState();
    this.canonicalTurns =
      options.canonicalTurns ?? createInitialCanonicalTurnState();
    this.memorySignals = options.memorySignals ?? [];
    this.pendingTurns = [];
    this.processingTurns = false;
  }

  static create(options = {}) {
    const brainSessionId = `desktop-session-${Date.now()}`;
    let runtime;
    const execution = createLocalExecutionLayer({
      mode: options.executionMode,
      onRawEvent: options.onRawExecutorEvent
    });
    const intentResolver =
      options.intentResolver ?? createDefaultIntentResolver();

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
      },
      {
        persistDirectAssistantReplies: false
      }
    );

    runtime = new DesktopSessionRuntime({
      brainSessionId,
      loop,
      intentResolver,
      onStateChange: options.onStateChange
    });

    runtime.execution = execution;
    return runtime;
  }

  async collectState() {
  const [messages, tasks] = await Promise.all([
      this.loop.listConversation(this.brainSessionId),
      this.loop.listActiveTasks(this.brainSessionId)
    ]);
    const intakeSession = await this.loop.getActiveTaskIntake(
      this.brainSessionId
    );
    const taskTimelines = await Promise.all(
      tasks.map(async (task) => ({
        taskId: task.id,
        events: await this.loop.listTaskEvents(task.id)
      }))
    );
    const subAvatars = buildSubAvatarViewModels(tasks, taskTimelines);
    const intake = intakeSession
      ? {
          active: true,
          missingSlots: intakeSession.missingSlots,
          lastQuestion: intakeSession.lastQuestion,
          workingText: intakeSession.workingText
        }
      : {
          active: false,
          missingSlots: [],
          lastQuestion: null,
          workingText: ""
        };
    const mainAvatarState = deriveMainAvatarState({
      activityState: this.activityState,
      inputState: this.inputState,
      intake,
      notificationCenter: this.notificationCenter,
      memorySignals: this.memorySignals,
      tasks
    });

    return {
      brainSessionId: this.brainSessionId,
      executionMode: this.execution.mode,
      mic: this.micState,
      activity: this.activityState,
      input: this.inputState,
      notifications: this.notificationCenter,
      pendingBriefingCount: this.notificationCenter.pending.length,
      messages,
      tasks,
      taskTimelines,
      canonicalTurnStream: this.canonicalTurns,
      memorySignals: this.memorySignals,
      intake,
      avatar: {
        mainState: mainAvatarState,
        subAvatars
      },
      debug:
        this.execution.debug?.enabled
          ? {
              rawExecutorEvents: this.execution.debug.rawEvents.slice(-20)
            }
          : null
    };
  }

  async init() {
    return this.collectState();
  }

  async waitForIdle() {
    while (this.processingTurns || this.pendingTurns.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await this.loop.waitForBackgroundWork?.();
    return this.collectState();
  }

  async sendText(text) {
    return this.submitCanonicalUserTurn({
      text,
      source: "typed",
      createdAt: new Date().toISOString()
    });
  }

  async handleVoiceTranscript(text) {
    return this.submitCanonicalUserTurn({
      text,
      source: "voice",
      createdAt: new Date().toISOString()
    });
  }

  async submitCanonicalUserTurn({ text, source, createdAt }) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return this.collectState();
    }

    const turnCreatedAt = createdAt ?? new Date().toISOString();
    this.canonicalTurns = [
      ...this.canonicalTurns,
      {
        source,
        text: normalizedText,
        createdAt: turnCreatedAt
      }
    ].slice(-20);
    this.memorySignals = extractMemorySignals(normalizedText).slice(-6);

    return this.enqueueTurn({
      text: normalizedText,
      source,
      createdAt: turnCreatedAt
    });
  }

  async enqueueTurn(turn) {
    const now = new Date().toISOString();
    this.pendingTurns.push({
      ...turn,
      createdAt: turn.createdAt ?? now
    });
    this.inputState = {
      ...this.inputState,
      inFlight: true,
      queueSize: this.pendingTurns.length,
      lastSubmittedText: turn.text,
      lastError: null
    };

    await this.publishState();
    void this.processTurnQueue();

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

  async processTurnQueue() {
    if (this.processingTurns) {
      return;
    }

    this.processingTurns = true;
    try {
      while (this.pendingTurns.length > 0) {
        const turn = this.pendingTurns.shift();
        if (!turn) {
          continue;
        }

        this.inputState = {
          ...this.inputState,
          inFlight: true,
          activeText: turn.text,
          queueSize: this.pendingTurns.length,
          lastError: null
        };
        await this.publishState();

        try {
          const intent = turn.intent ?? (await this.intentResolver.resolve(turn.text));
          await this.loop.handleTurn({
            brainSessionId: this.brainSessionId,
            utterance: {
              text: turn.text,
              intent,
              createdAt: turn.createdAt
            },
            now: turn.createdAt
          });
        } catch (error) {
          this.inputState = {
            ...this.inputState,
            lastError: error instanceof Error ? error.message : String(error)
          };
        } finally {
          this.inputState = {
            ...this.inputState,
            inFlight: this.pendingTurns.length > 0,
            queueSize: this.pendingTurns.length,
            activeText: null
          };
          await this.publishState();
        }
      }
    } finally {
      this.processingTurns = false;
      if (this.pendingTurns.length > 0) {
        void this.processTurnQueue();
      }
    }
  }
}
