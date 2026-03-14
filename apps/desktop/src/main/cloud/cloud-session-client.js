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

export class CloudSessionClient {
  constructor(options = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.AGENT_CLOUD_URL?.trim() ??
      "http://127.0.0.1:8080";
    this.onConversationState = options.onConversationState;
    this.onTaskState = options.onTaskState;
    this.onAudioChunk = options.onAudioChunk;
    this.onDebugEvent = options.onDebugEvent;
    this.state = createInitialState();
    this.webSocket = null;
    this.sessionToken = null;
    this.brainSessionId = null;
    this.execution = createLocalExecutionLayer({
      mode: process.env.DESKTOP_EXECUTOR,
      onRawEvent: options.onRawExecutorEvent
    });
  }

  async getState() {
    return { ...this.state };
  }

  async connect(passcode) {
    if (this.webSocket || this.state.connecting) {
      return this.getState();
    }

    const resolvedPasscode =
      passcode?.trim() || process.env.JUDGE_PASSCODE?.trim();
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
    return this.getState();
  }

  async disconnect() {
    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }
    this.sessionToken = null;
    this.brainSessionId = null;
    this.state = {
      ...createInitialState(),
      muted: this.state.muted
    };
    await this.publishConversationState();
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
    if (!this.isReadyForLiveInput()) {
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
    if (this.state.muted || !this.isReadyForLiveInput()) {
      return;
    }
    this.send({
      type: "audio_chunk",
      data: audioData,
      mimeType
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

  async handleServerEvent(event) {
    switch (event?.type) {
      case "session_ready":
        this.brainSessionId = event.brainSessionId;
        this.state = {
          ...event.conversation
        };
        await this.onTaskState?.(event.tasks, event.brainSessionId);
        await this.publishConversationState();
        return;
      case "conversation_state":
        this.state = {
          ...event.state
        };
        await this.publishConversationState();
        return;
      case "task_state":
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

  isReadyForLiveInput() {
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
}
