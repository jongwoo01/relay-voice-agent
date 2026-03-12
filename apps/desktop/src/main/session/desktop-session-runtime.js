import {
  createDefaultTaskIntakeResolver,
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
import { logDesktop } from "../debug/desktop-log.js";

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

function createInitialDecisionTrace() {
  return [];
}

function createInitialLastAssistantEnvelope() {
  return null;
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
    this.decisionTrace = options.decisionTrace ?? createInitialDecisionTrace();
    this.memorySignals = options.memorySignals ?? [];
    this.lastAssistantEnvelope =
      options.lastAssistantEnvelope ?? createInitialLastAssistantEnvelope();
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
    const taskIntakeResolver =
      options.taskIntakeResolver ?? createDefaultTaskIntakeResolver();

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
        persistDirectAssistantReplies: false,
        taskIntakeResolver
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
  const [messages, tasks, recentTasks] = await Promise.all([
      this.loop.listConversation(this.brainSessionId),
      this.loop.listActiveTasks(this.brainSessionId),
      this.loop.listRecentTasks(this.brainSessionId, 5)
    ]);
    const intakeSession = await this.loop.getActiveTaskIntake(
      this.brainSessionId
    );
    const taskTimelines = await Promise.all(
      recentTasks.map(async (task) => ({
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
      recentTasks,
      taskTimelines,
      canonicalTurnStream: this.canonicalTurns,
      memorySignals: this.memorySignals,
      lastAssistantEnvelope: this.lastAssistantEnvelope,
      intake,
      avatar: {
        mainState: mainAvatarState,
        subAvatars
      },
      debug:
        this.execution.debug?.enabled
          ? {
              rawExecutorEvents: this.execution.debug.rawEvents.slice(-20),
              decisionTrace: this.decisionTrace
            }
          : null
    };
  }

  appendDecisionTrace(label, details) {
    const at = new Date().toISOString();
    const line = details ? `${at} ${label}: ${details}` : `${at} ${label}`;
    this.decisionTrace = [...this.decisionTrace, line].slice(-30);
    logDesktop(`[desktop-runtime] ${line}`);
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

  async resolveIntent(text) {
    return this.intentResolver.resolve(text.trim());
  }

  async handleDelegateToGeminiCli(input) {
    const result = await this.loop.handleDelegateToGeminiCli({
      brainSessionId: this.brainSessionId,
      ...input
    });

    return {
      result,
      state: await this.collectState()
    };
  }

  recordCanonicalTurn({ text, source, createdAt }) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return null;
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
    this.appendDecisionTrace(
      "canonical turn",
      `${source} · ${normalizedText}`
    );

    return {
      text: normalizedText,
      source,
      createdAt: turnCreatedAt
    };
  }

  async submitCanonicalUserTurn({ text, source, createdAt, intent }) {
    const canonicalTurn = this.recordCanonicalTurn({
      text,
      source,
      createdAt
    });
    if (!canonicalTurn) {
      return this.collectState();
    }

    return this.enqueueTurn({
      ...canonicalTurn,
      intent
    });
  }

  async submitCanonicalUserTurnForDecision({ text, source, createdAt, intent }) {
    const canonicalTurn = this.recordCanonicalTurn({
      text,
      source,
      createdAt
    });
    if (!canonicalTurn) {
      return {
        handled: null,
        state: await this.collectState()
      };
    }

    const handled = await this.enqueueTurnAndWaitForDecision({
      ...canonicalTurn,
      intent
    });

    return {
      handled,
      state: await this.collectState()
    };
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

  async enqueueTurnAndWaitForDecision(turn) {
    const now = new Date().toISOString();
    return new Promise(async (resolve, reject) => {
      this.pendingTurns.push({
        ...turn,
        createdAt: turn.createdAt ?? now,
        decisionDeferred: {
          resolve,
          reject
        }
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
    });
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
        let handled;

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
          this.appendDecisionTrace(
            "intent resolved",
            `${intent} · ${turn.text}`
          );
          handled = await this.loop.handleTurn({
            brainSessionId: this.brainSessionId,
            utterance: {
              text: turn.text,
              intent,
              createdAt: turn.createdAt
            },
            now: turn.createdAt
          });
          this.appendDecisionTrace(
            "loop result",
            `${handled.assistant.tone}${handled.task ? ` · task:${handled.task.status}` : ""} · ${handled.assistant.text}`
          );
          this.lastAssistantEnvelope = {
            text: handled.assistant.text,
            tone: handled.assistant.tone,
            createdAt: turn.createdAt
          };
        } catch (error) {
          this.appendDecisionTrace(
            "loop error",
            error instanceof Error ? error.message : String(error)
          );
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
          if (turn.decisionDeferred) {
            if (this.inputState.lastError) {
              turn.decisionDeferred.reject(new Error(this.inputState.lastError));
            } else {
              turn.decisionDeferred.resolve(handled);
            }
          }
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
