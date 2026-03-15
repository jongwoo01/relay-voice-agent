import { createLocalExecutionLayer } from "../execution/local-execution-layer.js";

function createInitialState() {
  return {
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
}

function createInitialHistoryState() {
  return {
    loading: false,
    error: null,
    sessions: []
  };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

function isLiveInputDebugEnabled() {
  return process.env.NODE_ENV !== "production";
}

async function waitForSocketClose(socket, timeoutMs = 250) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const timer = setTimeout(() => {
      try {
        if (socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      } finally {
        finish();
      }
    }, timeoutMs);

    socket.addEventListener("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export class CloudSessionClient {
  constructor(options = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.AGENT_CLOUD_URL?.trim() ??
      "https://gemini-live-agent-uctmsffp5q-uc.a.run.app";
    this.onConversationState = options.onConversationState;
    this.onTaskState = options.onTaskState;
    this.onAudioChunk = options.onAudioChunk;
    this.onDebugEvent = options.onDebugEvent;
    this.onHistoryState = options.onHistoryState;
    this.state = createInitialState();
    this.historyState = createInitialHistoryState();
    this.webSocket = null;
    this.sessionToken = null;
    this.brainSessionId = null;
    this.execution = createLocalExecutionLayer({
      mode: process.env.DESKTOP_EXECUTOR,
      onRawEvent: options.onRawExecutorEvent
    });
    this.seenConversationDebugIds = new Set();
    this.lastIntakeDebugKey = null;
    this.liveAudioChunkCount = 0;
    this.liveActivitySequence = 0;
  }

  async getState() {
    return { ...this.state };
  }

  async getHistoryState() {
    return {
      ...this.historyState,
      sessions: [...(this.historyState.sessions ?? [])]
    };
  }

  async connect(passcode) {
    if (this.webSocket || this.state.connecting) {
      return this.getState();
    }

    const resolvedPasscode = passcode?.trim();
    if (!resolvedPasscode) {
      throw new Error("Judge passcode is required to connect.");
    }

    this.state = {
      ...this.state,
      connecting: true,
      status: "connecting",
      error: null
    };
    await this.publishConversationState();

    const response = await fetch(new URL("/judge/session", this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        passcode: resolvedPasscode
      })
    });
    if (!response.ok) {
      let message = `Judge session request failed (${response.status})`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string") {
          message = body.error;
        }
      } catch {
        // Ignore response parse failures.
      }
      this.state = {
        ...this.state,
        connecting: false,
        status: "error",
        error: message
      };
      await this.publishConversationState();
      throw new Error(message);
    }

    const payload = await response.json();
    this.sessionToken = payload.token;
    this.brainSessionId = payload.brainSessionId;
    const wsUrl = String(payload.wsUrl);
    await this.openWebSocket(wsUrl);
    await this.refreshHistory();
    return this.getState();
  }

  async disconnect() {
    const socket = this.webSocket;
    if (socket) {
      if (socket.readyState === WebSocket.OPEN) {
        this.send({
          type: "end_session",
          reason: "user_hangup"
        });
        await waitForSocketClose(socket);
      } else if (socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
      this.webSocket = null;
    }
    this.sessionToken = null;
    this.brainSessionId = null;
    this.state = {
      ...createInitialState(),
      muted: this.state.muted
    };
    this.historyState = createInitialHistoryState();
    await this.publishConversationState();
    await this.publishHistoryState();
    return this.getState();
  }

  async setMuted(muted) {
    this.state = {
      ...this.state,
      muted: Boolean(muted)
    };
    await this.publishConversationState();
    return this.getState();
  }

  endAudioStream() {
    if (!this.isREADYForLiveInput()) {
      return;
    }
    this.send({
      type: "audio_stream_end"
    });
  }

  async sendText(text) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return this.getState();
    }
    this.send({
      type: "typed_turn",
      text: normalizedText
    });
    return this.getState();
  }

  sendAudioChunk(audioData, mimeType = "audio/pcm;rate=16000") {
    const ready = this.isREADYForLiveInput();
    if (this.state.muted || !ready) {
      if (isLiveInputDebugEnabled()) {
        console.log(
          `[live-input][desktop-client] drop audio_chunk muted=${this.state.muted} ready=${ready} status=${this.state.status}`
        );
      }
      return;
    }
    this.liveAudioChunkCount += 1;
    if (isLiveInputDebugEnabled() && (this.liveAudioChunkCount <= 3 || this.liveAudioChunkCount % 20 === 0)) {
      console.log(
        `[live-input][desktop-client] send audio_chunk seq=${this.liveActivitySequence} chunk=${this.liveAudioChunkCount} bytes=${audioData.length} mime=${mimeType}`
      );
    }
    this.send({
      type: "audio_chunk",
      data: audioData,
      mimeType
    });
  }

  startActivity() {
    const ready = this.isREADYForLiveInput();
    if (this.state.muted || !ready) {
      if (isLiveInputDebugEnabled()) {
        console.log(
          `[live-input][desktop-client] drop activity_start muted=${this.state.muted} ready=${ready} status=${this.state.status}`
        );
      }
      return;
    }
    this.liveActivitySequence += 1;
    this.liveAudioChunkCount = 0;
    if (isLiveInputDebugEnabled()) {
      console.log(
        `[live-input][desktop-client] send activity_start seq=${this.liveActivitySequence}`
      );
    }
    this.send({
      type: "activity_start"
    });
  }

  endActivity() {
    const ready = this.isREADYForLiveInput();
    if (!ready) {
      if (isLiveInputDebugEnabled()) {
        console.log(
          `[live-input][desktop-client] drop activity_end ready=${ready} status=${this.state.status}`
        );
      }
      return;
    }
    if (isLiveInputDebugEnabled()) {
      console.log(
        `[live-input][desktop-client] send activity_end seq=${this.liveActivitySequence} chunks=${this.liveAudioChunkCount}`
      );
    }
    this.send({
      type: "activity_end"
    });
  }

  async openWebSocket(wsUrl) {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let settled = false;

      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "auth",
            token: this.sessionToken
          })
        );
      });

      socket.addEventListener("message", async (event) => {
        let payload;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }

        try {
          await this.handleServerEvent(payload);
          if (!settled && payload?.type === "session_ready") {
            settled = true;
            this.webSocket = socket;
            resolve();
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      });

      socket.addEventListener("close", () => {
        this.webSocket = null;
        this.state = {
          ...this.state,
          connected: false,
          connecting: false,
          status: "idle"
        };
        void this.publishConversationState();
        if (!settled) {
          settled = true;
          reject(new Error("Cloud session closed before ready"));
        }
      });

      socket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error("Cloud session connection failed"));
        }
      });
    });
  }

  async refreshHistory() {
    if (!this.sessionToken) {
      this.historyState = createInitialHistoryState();
      await this.publishHistoryState();
      return this.getHistoryState();
    }

    this.historyState = {
      ...this.historyState,
      loading: true,
      error: null
    };
    await this.publishHistoryState();

    try {
      const response = await fetch(new URL("/judge/history", this.baseUrl), {
        headers: {
          authorization: `Bearer ${this.sessionToken}`
        }
      });
      if (!response.ok) {
        let message = `Judge history request failed (${response.status})`;
        try {
          const body = await response.json();
          if (typeof body?.error === "string") {
            message = body.error;
          }
        } catch {
          // Ignore response parse failures.
        }

        this.historyState = {
          loading: false,
          error: message,
          sessions: []
        };
        await this.publishHistoryState();
        throw new Error(message);
      }

      const payload = await response.json();
      this.historyState = {
        loading: false,
        error: null,
        sessions: Array.isArray(payload?.sessions) ? payload.sessions : []
      };
      await this.publishHistoryState();
      return this.getHistoryState();
    } catch (error) {
      if (!this.historyState.error) {
        this.historyState = {
          loading: false,
          error: normalizeError(error),
          sessions: []
        };
        await this.publishHistoryState();
      }
      throw error;
    }
  }

  async handleServerEvent(event) {
    switch (event?.type) {
      case "session_ready":
        this.brainSessionId = event.brainSessionId;
        this.state = {
          ...this.state,
          ...event.conversation,
          connected: true,
          connecting: false,
          error: null
        };
        await this.emitConversationDebugEvents(event.conversation);
        await this.emitTaskStateDebugEvents(event.tasks);
        await this.onTaskState?.(event.tasks, event.brainSessionId);
        await this.publishConversationState();
        return;
      case "conversation_state":
        {
          const socketOpen =
            Boolean(this.webSocket) && this.webSocket.readyState === WebSocket.OPEN;
        this.state = {
          ...this.state,
          ...event.state,
          connected:
            typeof event.state?.connected === "boolean"
              ? event.state.connected
              : socketOpen || this.state.connected,
          connecting:
            typeof event.state?.connecting === "boolean"
              ? event.state.connecting
              : false
        };
        await this.emitConversationDebugEvents(event.state);
        await this.publishConversationState();
        return;
        }
      case "task_state":
        await this.emitTaskStateDebugEvents(event.state);
        await this.onTaskState?.(event.state, this.brainSessionId);
        return;
      case "live_output_audio_chunk":
        await this.onAudioChunk?.({
          data: event.data,
          mimeType: event.mimeType
        });
        return;
      case "live_output_transcript":
        return;
      case "executor_request":
        await this.handleExecutorRequest(event.request);
        return;
      case "error":
        await this.onDebugEvent?.({
          source: "transport",
          kind: "session_error",
          summary: event.message || "Cloud session error",
          detail: this.brainSessionId
            ? `brain session ${this.brainSessionId}`
            : "before session ready"
        });
        this.state = {
          ...this.state,
          connecting: false,
          connected: false,
          status: "error",
          error: event.message || "Cloud session error"
        };
        await this.publishConversationState();
        throw new Error(this.state.error);
      default:
        return;
    }
  }

  async emitConversationDebugEvents(state) {
    const timeline = Array.isArray(state?.conversationTimeline)
      ? state.conversationTimeline
      : [];

    for (const item of timeline) {
      if (!item?.id || this.seenConversationDebugIds.has(item.id)) {
        continue;
      }

      this.seenConversationDebugIds.add(item.id);

      if (item.responseSource !== "delegate" && item.kind !== "task_event") {
        continue;
      }

      await this.onDebugEvent?.({
        source: "runtime",
        kind: item.kind ?? "conversation_item",
        summary: item.text || item.taskStatus || "Delegate update",
        detail: [
          item.turnId ? `turn ${item.turnId}` : null,
          item.taskId ? `task ${item.taskId}` : null,
          item.taskStatus ?? null
        ]
          .filter(Boolean)
          .join(" · "),
        turnId: item.turnId,
        taskId: item.taskId,
        createdAt: item.createdAt
      });
    }
  }

  async emitTaskStateDebugEvents(state) {
    const intake = state?.intake;
    const isActive = intake?.active === true;
    const intakeKey = isActive
      ? JSON.stringify({
          workingText: intake.workingText ?? "",
          missingSlots: intake.missingSlots ?? [],
          lastQuestion: intake.lastQuestion ?? ""
        })
      : null;

    if (!isActive) {
      this.lastIntakeDebugKey = null;
      return;
    }

    if (intakeKey === this.lastIntakeDebugKey) {
      return;
    }

    this.lastIntakeDebugKey = intakeKey;
    await this.onDebugEvent?.({
      source: "runtime",
      kind: "task_intake",
      summary: intake.lastQuestion || "Task intake is waiting for more detail.",
      detail: [
        intake.workingText ? `request: ${intake.workingText}` : null,
        Array.isArray(intake.missingSlots) && intake.missingSlots.length > 0
          ? `missing: ${intake.missingSlots.join(", ")}`
          : null
      ]
        .filter(Boolean)
        .join(" · ")
    });
  }

  async handleExecutorRequest(request) {
    try {
      const result = await this.execution.executor.run(request.request, async (progressEvent) => {
        this.send({
          type: "executor_progress",
          runId: request.runId,
          taskId: request.taskId,
          event: progressEvent
        });
      });

      this.send({
        type: "executor_terminal",
        runId: request.runId,
        taskId: request.taskId,
        ok: true,
        result
      });
    } catch (error) {
      this.send({
        type: "executor_terminal",
        runId: request.runId,
        taskId: request.taskId,
        ok: false,
        error: normalizeError(error)
      });
    }
  }

  send(payload) {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      throw new Error("Cloud session is not connected");
    }

    this.webSocket.send(JSON.stringify(payload));
  }

  isREADYForLiveInput() {
    return (
      Boolean(this.webSocket) &&
      this.webSocket.readyState === WebSocket.OPEN &&
      this.state.connected === true &&
      this.state.connecting !== true &&
      this.state.status !== "idle" &&
      this.state.status !== "error"
    );
  }

  async publishConversationState() {
    await this.onConversationState?.(this.state, this.brainSessionId);
  }

  async publishHistoryState() {
    await this.onHistoryState?.(this.historyState, this.brainSessionId);
  }
}
