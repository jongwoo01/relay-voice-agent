import {
  createDefaultDesktopSettings,
  createDefaultSystemStatus
} from "./desktop-settings.js";

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
    this.settings = null;
    this.systemState = null;
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

  setSettings(settings) {
    this.settings = settings;
  }

  setSystemState(state) {
    this.systemState = state;
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
      executorHealth: {
        status: "unknown",
        code: null,
        summary: "Gemini CLI health has not been checked yet.",
        detail: "Relay can run a lightweight Gemini CLI probe and show the result here.",
        checkedAt: null,
        canRunLocalTasks: false,
        commandPath: null,
        authStrategy: "unknown",
        exitCode: null,
        probeWorkingDirectory: null,
        stdoutSnippet: null,
        stderrSnippet: null
      },
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
      activityDetection: {
        mode: "auto",
        source: "server"
      },
      routing: { mode: "idle", summary: "", detail: "" },
      conversationTimeline: [],
      conversationTurns: [],
      activeTurnId: null,
      rawInputPartial: "",
      inputPartial: "",
      lastUserTranscript: "",
      outputTranscript: ""
    };
    const historyState = this.historyState ?? {
      loading: false,
      error: null,
      sessions: []
    };
    const settings = this.settings ?? createDefaultDesktopSettings();
    const systemState = this.systemState ?? createDefaultSystemStatus();

    const conversationTurns = dedupeTurns(liveState.conversationTurns ?? []);
    const conversationTimeline = dedupeTimeline(
      [...(liveState.conversationTimeline ?? [])],
      conversationTurns
    );

    return {
      brainSessionId: sessionState.brainSessionId,
      executionMode: sessionState.executionMode,
      executorHealth:
        sessionState.executorHealth ?? {
          status: "unknown",
          code: null,
          summary: "Gemini CLI health has not been checked yet.",
          detail: "Relay can run a lightweight Gemini CLI probe and show the result here.",
          checkedAt: null,
          canRunLocalTasks: false,
          commandPath: null,
          authStrategy: "unknown",
          exitCode: null,
          probeWorkingDirectory: null,
          stdoutSnippet: null,
          stderrSnippet: null
        },
      conversationTimeline,
      conversationTurns,
      activeTurnId: liveState.activeTurnId ?? null,
      rawInputPartial: liveState.rawInputPartial ?? "",
      inputPartial: liveState.inputPartial ?? "",
      lastUserTranscript: liveState.lastUserTranscript ?? "",
      outputTranscript: liveState.outputTranscript ?? "",
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
      settings,
      systemStatus: systemState,
      voiceControlState: {
        connected: liveState.connected,
        connecting: liveState.connecting,
        status: liveState.status,
        muted: liveState.muted,
        error: liveState.error,
        activityDetection: liveState.activityDetection ?? {
          mode: "auto",
          source: "server"
        },
        routing: liveState.routing,
        mic: sessionState.mic,
        activity: sessionState.activity
      },
      inputState: sessionState.input,
      runtimeError: sessionState.input?.lastError ?? liveState.error ?? null
    };
  }
}
