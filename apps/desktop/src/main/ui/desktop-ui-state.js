function compareByTimestamp(left, right) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function getKindPriority(kind) {
  if (kind === "user_message") {
    return 0;
  }

  if (kind === "assistant_message") {
    return 1;
  }

  if (kind === "task_event") {
    return 2;
  }

  return 3;
}

function getTurnStartTime(turnsById, item) {
  if (!item?.turnId) {
    return item?.createdAt ?? "";
  }

  return turnsById.get(item.turnId)?.startedAt ?? item.createdAt ?? "";
}

function buildTaskTurnIndex(turns = []) {
  const byTaskId = new Map();

  for (const turn of turns) {
    if (!turn?.taskId || byTaskId.has(turn.taskId)) {
      continue;
    }
    byTaskId.set(turn.taskId, turn);
  }

  return byTaskId;
}

function normalizeNotificationItems(
  notifications = { delivered: [], pending: [] },
  existingTurns = []
) {
  const all = [...(notifications.delivered ?? []), ...(notifications.pending ?? [])];
  const turnsByTaskId = buildTaskTurnIndex(existingTurns);

  return all.map((plan, index) => {
    const createdAt =
      typeof plan.createdAt === "string" && plan.createdAt
        ? plan.createdAt
        : new Date(Date.now() + index).toISOString();
    const taskId = typeof plan.taskId === "string" ? plan.taskId : undefined;
    const existingTurn = taskId ? turnsByTaskId.get(taskId) : undefined;
    const turnId =
      existingTurn?.turnId ??
      (taskId
        ? `task-turn:${taskId}:${createdAt}`
        : `task-turn:${plan.reason ?? "notification"}:${createdAt}:${index}`);
    const actionable =
      plan.reason === "approval_required" || plan.reason === "task_waiting_input";
    const timelineItemId = actionable
      ? `${turnId}:task-event:${plan.reason ?? "pending"}:${createdAt}`
      : `${turnId}:assistant:${plan.reason ?? "notification"}:${createdAt}`;
    const inputMode = existingTurn?.inputMode ?? "voice";

    return {
      timelineItem: {
        id: timelineItemId,
        turnId,
        kind: actionable ? "task_event" : "assistant_message",
        inputMode,
        speaker: actionable ? "system" : "assistant",
        text: plan.uiText ?? "",
        partial: false,
        streaming: false,
        interrupted: false,
        tone: actionable ? "clarify" : "reply",
        taskId,
        taskStatus:
          plan.reason === "task_completed"
            ? "completed"
            : plan.reason === "task_failed"
              ? "failed"
              : plan.reason === "approval_required"
                ? "approval_required"
                : plan.reason === "task_waiting_input"
                  ? "waiting_input"
                  : undefined,
        responseSource: "delegate",
        createdAt,
        updatedAt: createdAt
      },
      turn: {
        turnId,
        inputMode,
        stage:
          plan.reason === "task_completed"
            ? "completed"
            : plan.reason === "task_failed"
              ? "failed"
              : "waiting_input",
        assistantMessageId: actionable ? existingTurn?.assistantMessageId : timelineItemId,
        taskId,
        startedAt: existingTurn?.startedAt ?? createdAt,
        updatedAt: createdAt
      }
    };
  });
}

function dedupeTimeline(items, turns = []) {
  const byId = new Map();
  const turnsById = new Map(turns.map((turn) => [turn.turnId, turn]));

  for (const item of items) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort((left, right) => {
    const turnStartComparison = compareByTimestamp(
      getTurnStartTime(turnsById, left),
      getTurnStartTime(turnsById, right)
    );
    if (turnStartComparison !== 0) {
      return turnStartComparison;
    }

    const timestampComparison = compareByTimestamp(left.createdAt, right.createdAt);
    if (timestampComparison !== 0) {
      return timestampComparison;
    }

    if (left.turnId && right.turnId && left.turnId !== right.turnId) {
      return left.turnId.localeCompare(right.turnId);
    }

    const kindComparison =
      getKindPriority(left.kind) - getKindPriority(right.kind);
    if (kindComparison !== 0) {
      return kindComparison;
    }

    return left.id.localeCompare(right.id);
  });
}

function dedupeTurns(turns) {
  const byId = new Map();

  for (const turn of turns) {
    if (!turn?.turnId) {
      continue;
    }
    byId.set(turn.turnId, {
      ...byId.get(turn.turnId),
      ...turn
    });
  }

  return [...byId.values()].sort((left, right) => {
    const startComparison = compareByTimestamp(
      left.startedAt ?? "",
      right.startedAt ?? ""
    );
    if (startComparison !== 0) {
      return startComparison;
    }

    return left.turnId.localeCompare(right.turnId);
  });
}

export class DesktopUiStateStore {
  constructor() {
    this.sessionState = null;
    this.liveState = null;
    this.historyState = null;
    this.debugEvents = [];
  }

  setSessionState(state) {
    this.sessionState = state;
  }

  setLiveState(state) {
    this.liveState = state;
  }

  setHistoryState(state) {
    this.historyState = state;
  }

  appendDebugEvent(event) {
    const createdAt = event.createdAt ?? new Date().toISOString();
    const id =
      event.id ??
      `${event.source}:${event.kind}:${createdAt}:${this.debugEvents.length + 1}`;

    this.debugEvents = [
      ...this.debugEvents,
      {
        ...event,
        id,
        createdAt
      }
    ].slice(-250);
  }

  compose() {
    const sessionState = this.sessionState ?? {
      brainSessionId: null,
      executionMode: "unknown",
      mic: { mode: "idle", enabled: false },
      activity: { userSpeaking: false, assistantSpeaking: false },
      input: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
      notifications: { delivered: [], pending: [] },
      pendingBriefingCount: 0,
      tasks: [],
      recentTasks: [],
      taskTimelines: [],
      taskRunnerDetails: [],
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      messages: []
    };
    const liveState = this.liveState ?? {
      connected: false,
      connecting: false,
      status: "idle",
      muted: false,
      error: null,
      routing: { mode: "idle", summary: "", detail: "" },
      conversationTimeline: [],
      conversationTurns: [],
      activeTurnId: null,
      inputPartial: "",
      lastUserTranscript: "",
      outputTranscript: ""
    };
    const historyState = this.historyState ?? {
      loading: false,
      error: null,
      sessions: []
    };

    const liveConversationTurns = liveState.conversationTurns ?? [];
    const notificationItems = normalizeNotificationItems(
      sessionState.notifications,
      liveConversationTurns
    );
    const conversationTurns = dedupeTurns([
      ...liveConversationTurns,
      ...notificationItems.map((item) => item.turn)
    ]);
    const conversationTimeline = dedupeTimeline(
      [
        ...(liveState.conversationTimeline ?? []),
        ...notificationItems.map((item) => item.timelineItem)
      ],
      conversationTurns
    );

    return {
      brainSessionId: sessionState.brainSessionId,
      executionMode: sessionState.executionMode,
      conversationTimeline,
      conversationTurns,
      activeTurnId: liveState.activeTurnId ?? null,
      debugInspector: {
        events: [...this.debugEvents].sort((left, right) =>
          compareByTimestamp(left.createdAt, right.createdAt)
        ),
        availableSources: ["transport", "live", "bridge", "runtime", "executor"]
      },
      taskSummary: {
        activeTasks: sessionState.tasks ?? [],
        recentTasks: sessionState.recentTasks ?? [],
        taskTimelines: sessionState.taskTimelines ?? [],
        taskRunnerDetails: sessionState.taskRunnerDetails ?? [],
        intake: sessionState.intake,
        avatar: sessionState.avatar,
        notifications: sessionState.notifications,
        pendingBriefingCount: sessionState.pendingBriefingCount ?? 0
      },
      historySummary: {
        loading: historyState.loading ?? false,
        error: historyState.error ?? null,
        sessions: historyState.sessions ?? []
      },
      voiceControlState: {
        connected: liveState.connected,
        connecting: liveState.connecting,
        status: liveState.status,
        muted: liveState.muted,
        error: liveState.error,
        routing: liveState.routing,
        mic: sessionState.mic,
        activity: sessionState.activity
      },
      inputState: sessionState.input,
      runtimeError: sessionState.input?.lastError ?? liveState.error ?? null
    };
  }
}
