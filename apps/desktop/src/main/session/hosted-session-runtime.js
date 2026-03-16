function createInitialState() {
  return {
    brainSessionId: null,
    executionMode: "unknown",
    executorHealth: {
      status: "unknown",
      code: null,
      summary: "Gemini CLI health has not been checked yet.",
      detail: "Relay will check the local executor before running Gemini-backed tasks.",
      checkedAt: null,
      canRunLocalTasks: false,
      commandPath: null,
      stderrSnippet: null
    },
    mic: { mode: "idle", enabled: true },
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
}

export class HostedSessionRuntime {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange;
    this.state = createInitialState();
  }

  async init() {
    return this.publishState();
  }

  async getState() {
    return { ...this.state };
  }

  async setExecutionContext(input = {}) {
    this.state = {
      ...this.state,
      executionMode: input.executionMode ?? this.state.executionMode,
      executorHealth: input.executorHealth ?? this.state.executorHealth
    };
    return this.publishState();
  }

  async setBrainSessionId(brainSessionId) {
    this.state = {
      ...this.state,
      brainSessionId
    };
    return this.publishState();
  }

  async applyRemoteTaskState(taskState) {
    this.state = {
      ...this.state,
      tasks: taskState.tasks ?? [],
      recentTasks: taskState.recentTasks ?? [],
      taskTimelines: taskState.taskTimelines ?? [],
      taskRunnerDetails: taskState.taskRunnerDetails ?? [],
      intake:
        taskState.intake ?? {
          active: false,
          missingSlots: [],
          lastQuestion: null,
          workingText: ""
        },
      avatar:
        taskState.avatar ?? {
          mainState: "idle",
          taskRunners: []
        },
      notifications:
        taskState.notifications ?? {
          delivered: [],
          pending: []
        },
      pendingBriefingCount: taskState.pendingBriefingCount ?? 0
    };
    return this.publishState();
  }

  async startInput(text) {
    this.state = {
      ...this.state,
      input: {
        ...this.state.input,
        inFlight: true,
        activeText: text,
        lastError: null
      }
    };
    return this.publishState();
  }

  async finishInput() {
    this.state = {
      ...this.state,
      input: {
        ...this.state.input,
        inFlight: false,
        activeText: null
      }
    };
    return this.publishState();
  }

  async setError(message) {
    this.state = {
      ...this.state,
      input: {
        ...this.state.input,
        lastError: message || null,
        inFlight: false,
        activeText: null
      }
    };
    return this.publishState();
  }

  async toggleMic() {
    const enabled = !this.state.mic.enabled;
    this.state = {
      ...this.state,
      mic: {
        mode: enabled ? "ready" : "muted",
        enabled
      }
    };
    return this.publishState();
  }

  async setUserSpeaking(speaking) {
    this.state = {
      ...this.state,
      activity: {
        ...this.state.activity,
        userSpeaking: Boolean(speaking)
      }
    };
    return this.publishState();
  }

  async setAssistantSpeaking(speaking) {
    this.state = {
      ...this.state,
      activity: {
        ...this.state.activity,
        assistantSpeaking: Boolean(speaking)
      }
    };
    return this.publishState();
  }

  async publishState() {
    const snapshot = { ...this.state };
    if (this.onStateChange) {
      await this.onStateChange(snapshot);
    }
    return snapshot;
  }
}
