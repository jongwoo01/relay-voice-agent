import {
  GoogleLiveApiTransport
} from "@agent/agent-api";
import {
  ActivityHandling,
  Behavior,
  Modality,
  Type
} from "@google/genai";
import { logDesktop } from "../debug/desktop-log.js";

const SUPPORTED_LIVE_MODEL =
  process.env.LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025";

function createMetrics() {
  return {
    connectedAt: null,
    lastAudioChunkSentAt: null,
    firstInputPartialAt: null,
    lastInputPartialAt: null,
    firstInputFinalAt: null,
    lastInputFinalAt: null,
    firstOutputTranscriptAt: null,
    lastOutputTranscriptAt: null,
    firstOutputAudioAt: null,
    lastOutputAudioAt: null,
    lastTurnCompleteAt: null,
    rawEvents: []
  };
}

function createTurnDebug() {
  return {
    startedAt: null,
    inputPartials: 0,
    sawInputFinal: false,
    inputFinalText: "",
    outputTranscriptChunks: 0,
    outputTranscriptPreview: "",
    outputAudioChunks: 0,
    toolCalls: [],
    runtimeOwned: false,
    pendingRuntimeOwnership: false,
    waitingForInput: false,
    interrupted: false,
    turnComplete: false
  };
}

function createInitialState() {
  return {
    connected: false,
    connecting: false,
    status: "idle",
    muted: false,
    inputPartial: "",
    lastUserTranscript: "",
    outputTranscript: "",
    error: null,
    sentAudioChunkCount: 0,
    liveMessages: [],
    routing: {
      mode: "idle",
      summary: "아직 확인 중인 요청이 없습니다.",
      detail: ""
    },
    runtimeContext: null,
    runtimeGuardActive: false,
    sessionResumption: {
      resumable: false,
      handle: null,
      lastConsumedClientMessageIndex: null
    },
    metrics: createMetrics()
  };
}

function supportsLiveTools(model) {
  return Boolean(model);
}

function supportsSessionManagementFeatures(model) {
  return !/native-audio-preview/i.test(model);
}

function createPersonaInstruction({ toolEnabled }) {
  const lines = [
    "You are Desktop Companion, a concise desktop voice assistant.",
    "Keep responses calm, direct, and brief.",
    "Most replies must be one short sentence. Never exceed two short sentences.",
    "Do not be proactive, playful, or chatty unless the user explicitly asks for that style.",
    "If the user asks about the current state of local files, folders, apps, browser tabs, or anything on this machine, never guess or invent specifics.",
    "For local-machine questions, say you will check first, then wait for the task/result flow instead of pretending you already know the answer.",
    "Do not claim that files were moved, renamed, deleted, summarized, or organized unless the task/executor result explicitly confirmed it.",
    "If the user interrupts, stop cleanly and pivot to the new request immediately.",
    "For greetings or small talk, reply once and stop. Do not add follow-up questions unless the user asked for suggestions.",
    "For task acknowledgements, give one short acknowledgement and stop.",
    "When a delegated task is still running, do not volunteer extra updates. Only answer if the user asks.",
    "When a delegated task completes, report the grounded result once and stop. Do not repeat the same result unless the user asks again.",
    "After a grounded task result, do not add suggestions or extra questions unless the user explicitly asks."
  ];

  if (toolEnabled) {
    lines.splice(
      6,
      0,
      "When local-machine work, task follow-up, or task status is needed, call delegate_to_gemini_cli instead of answering from memory."
    );
  } else {
    lines.splice(
      6,
      0,
      "When local-machine work, task follow-up, or task status is needed, say you will check first and rely on the runtime task flow instead of answering from memory."
    );
  }

  return lines.join(" ");
}

function createDelegateToGeminiCliTool() {
  return {
    functionDeclarations: [
      {
        name: "delegate_to_gemini_cli",
        description:
          "Delegate local machine work, task follow-up, or task status checks to the Gemini CLI runtime.",
        behavior: Behavior.NON_BLOCKING,
        parameters: {
          type: Type.OBJECT,
          properties: {
            request: {
              type: Type.STRING,
              description:
                "Natural-language request to pass to the Gemini CLI runtime."
            }
          },
          required: ["request"]
        }
      }
    ]
  };
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function serializeForLog(value) {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack
    });
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeConnectConfig(model, config, { toolEnabled }) {
  return {
    model,
    toolEnabled,
    sessionManagementEnabled: supportsSessionManagementFeatures(model),
    responseModalities: config.responseModalities ?? [],
    hasInputAudioTranscription: Boolean(config.inputAudioTranscription),
    hasOutputAudioTranscription: Boolean(config.outputAudioTranscription),
    hasSessionResumption: Boolean(config.sessionResumption),
    sessionResumptionHandle: config.sessionResumption?.handle ?? null,
    hasContextWindowCompression: Boolean(config.contextWindowCompression),
    contextWindowCompression: config.contextWindowCompression ?? null,
    realtimeInputConfig: config.realtimeInputConfig ?? null,
    speechConfig: config.speechConfig ?? null,
    systemInstructionLength:
      typeof config.systemInstruction === "string"
        ? config.systemInstruction.length
        : null,
    toolNames:
      config.tools?.flatMap((tool) =>
        tool.functionDeclarations?.map((declaration) => declaration.name ?? "unknown") ?? []
      ) ?? []
  };
}

function nowIso() {
  return new Date().toISOString();
}

function isRuntimeFirstDecision(decision) {
  return decision?.mode === "runtime-first";
}

function normalizeHintText(text) {
  return typeof text === "string" ? text.trim() : "";
}

function scoreRoutingHint(text) {
  const normalized = normalizeHintText(text);
  if (!normalized) {
    return -1;
  }

  let score = normalized.length;
  if (
    /바탕화면|데스크톱|다운로드|폴더|파일|프로젝트|브라우저|탭|앱|desktop|downloads|folder|file/i.test(
      normalized
    )
  ) {
    score += 50;
  }
  if (
    /알려줘|보여줘|찾아줘|정리해줘|실행|요약해줘|개수|갯수|몇 개|무슨|뭐가|보이니|있니/i.test(
      normalized
    )
  ) {
    score += 25;
  }

  return score;
}

function looksLikeForcedRuntimeHint(text) {
  const normalized = normalizeHintText(text);
  if (!normalized) {
    return false;
  }

  return /바탕화면|화면|데스크톱|다운로드|폴더|파일|프로젝트|브라우저|탭|앱|개수|갯수|종류|이름|workspace|desktop|downloads|folder|file/i.test(
    normalized
  );
}

export class LiveVoiceSession {
  constructor(options = {}) {
    this.transport = options.transport ?? new GoogleLiveApiTransport();
    this.onStateChange = options.onStateChange;
    this.onAudioChunk = options.onAudioChunk;
    this.onUserTranscriptFinal = options.onUserTranscriptFinal;
    this.onToolCall = options.onToolCall;
    this.state = options.state ?? createInitialState();
    this.session = null;
    this.brainSessionId = null;
    this.outputTranscriptChunks = [];
    this.runtimeOwnedTurn = false;
    this.pendingRuntimeOwnership = false;
    this.currentTurnRoutingHints = [];
    this.currentTurnPartialBuffer = "";
    this.currentTurnTranscriptHandled = false;
    this.runtimeOwnershipDecisionInFlight = false;
    this.lastRuntimeContextSummary = "";
    this.lastSessionResumptionHandle = null;
    this.runtimeGuardActive = false;
    this.toolEnabled = false;
    this.currentTurnDebug = createTurnDebug();
  }

  prefersToolRouting() {
    return this.toolEnabled;
  }

  recordRoutingHint(text) {
    const normalized = normalizeHintText(text);
    if (!normalized) {
      return;
    }

    this.currentTurnRoutingHints = [
      ...this.currentTurnRoutingHints.filter(
        (candidate) => candidate !== normalized
      ),
      normalized
    ].slice(-6);
    this.pendingRuntimeOwnership =
      !this.toolEnabled &&
      this.currentTurnRoutingHints.some(looksLikeForcedRuntimeHint);
    if (this.pendingRuntimeOwnership) {
      logDesktop(
        `[live-session] runtime-first hint armed: ${this.currentTurnRoutingHints.at(-1)}`
      );
    }
  }

  clearRoutingHints() {
    this.currentTurnRoutingHints = [];
    this.pendingRuntimeOwnership = false;
    this.currentTurnPartialBuffer = "";
    this.currentTurnTranscriptHandled = false;
    this.runtimeOwnershipDecisionInFlight = false;
  }

  beginTurnDebug() {
    this.currentTurnDebug = createTurnDebug();
    this.currentTurnDebug.startedAt = nowIso();
  }

  summarizeCurrentTurnDebug() {
    return {
      startedAt: this.currentTurnDebug.startedAt,
      inputPartials: this.currentTurnDebug.inputPartials,
      sawInputFinal: this.currentTurnDebug.sawInputFinal,
      inputFinalText: this.currentTurnDebug.inputFinalText,
      outputTranscriptChunks: this.currentTurnDebug.outputTranscriptChunks,
      outputTranscriptPreview: this.currentTurnDebug.outputTranscriptPreview,
      outputAudioChunks: this.currentTurnDebug.outputAudioChunks,
      toolCalls: this.currentTurnDebug.toolCalls,
      runtimeOwned: this.currentTurnDebug.runtimeOwned,
      pendingRuntimeOwnership: this.currentTurnDebug.pendingRuntimeOwnership,
      waitingForInput: this.currentTurnDebug.waitingForInput,
      interrupted: this.currentTurnDebug.interrupted,
      turnComplete: this.currentTurnDebug.turnComplete
    };
  }

  appendPartialBuffer(fragment) {
    const normalized = normalizeHintText(fragment);
    if (!normalized) {
      return this.currentTurnPartialBuffer;
    }

    if (!this.currentTurnPartialBuffer) {
      this.currentTurnPartialBuffer = normalized;
      return this.currentTurnPartialBuffer;
    }

    if (normalized.length > this.currentTurnPartialBuffer.length) {
      this.currentTurnPartialBuffer = normalized;
      return this.currentTurnPartialBuffer;
    }

    if (!this.currentTurnPartialBuffer.endsWith(normalized)) {
      this.currentTurnPartialBuffer = `${this.currentTurnPartialBuffer}${normalized}`;
    }

    return this.currentTurnPartialBuffer;
  }

  async maybeHandleRuntimeFirstFromHints(reason) {
    if (this.toolEnabled) {
      return false;
    }

    if (this.currentTurnTranscriptHandled || !this.pendingRuntimeOwnership) {
      logDesktop(
        `[live-session] runtime-first skipped from ${reason}: handled=${this.currentTurnTranscriptHandled} pending=${this.pendingRuntimeOwnership}`
      );
      return false;
    }

    if (this.runtimeOwnershipDecisionInFlight) {
      this.appendMetricEvent(`runtime-first already in flight from ${reason}`);
      logDesktop(
        `[live-session] runtime-first already in flight from ${reason}`
      );
      return true;
    }

    const routingHints = [...this.currentTurnRoutingHints].sort(
      (left, right) => scoreRoutingHint(right) - scoreRoutingHint(left)
    );
    const routingHintText =
      routingHints[0] || this.currentTurnPartialBuffer || this.state.lastUserTranscript;

    if (!routingHintText) {
      logDesktop(
        `[live-session] runtime-first skipped from ${reason}: no routing hint text`
      );
      return false;
    }

    this.runtimeOwnershipDecisionInFlight = true;
    try {
      this.appendMetricEvent(
        `runtime-first check from ${reason}: ${routingHintText}`
      );
      const decision = await this.onUserTranscriptFinal?.(routingHintText, {
        routingHints,
        routingHintText,
        inferredFromPartial: true
      });

      this.currentTurnTranscriptHandled = true;
      logDesktop(
        `[live-session] runtime-first decision from ${reason}: ${decision?.mode ?? "none"}`
      );

      if (isRuntimeFirstDecision(decision)) {
        this.claimCurrentTurnForRuntime();
        this.appendMetricEvent("runtime-first voice turn claimed");
        if (decision.assistant?.text) {
          await this.injectAssistantMessage(
            decision.assistant.text,
            decision.assistant.tone
          );
        } else {
          await this.publishState();
        }
        return true;
      }

      return false;
    } finally {
      this.runtimeOwnershipDecisionInFlight = false;
    }
  }

  appendLiveMessage(message) {
    this.state = {
      ...this.state,
      liveMessages: [...this.state.liveMessages, message].slice(-30)
    };
  }

  upsertLiveMessage(id, patch) {
    const existingIndex = this.state.liveMessages.findIndex(
      (message) => message.id === id
    );

    if (existingIndex === -1) {
      this.appendLiveMessage({
        id,
        createdAt: nowIso(),
        ...patch
      });
      return;
    }

    const nextMessages = [...this.state.liveMessages];
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      ...patch
    };
    this.state = {
      ...this.state,
      liveMessages: nextMessages
    };
  }

  finalizeLiveMessage(id, patch = {}) {
    const existingIndex = this.state.liveMessages.findIndex(
      (message) => message.id === id
    );
    if (existingIndex === -1) {
      return;
    }

    const nextMessages = [...this.state.liveMessages];
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      partial: false,
      ...patch
    };
    this.state = {
      ...this.state,
      liveMessages: nextMessages
    };
  }

  updateMetrics(patch) {
    this.state = {
      ...this.state,
      metrics: {
        ...this.state.metrics,
        ...patch
      }
    };
  }

  appendMetricEvent(label, at = nowIso()) {
    if (label === "output audio chunk") {
      return;
    }
    const rawEvents = [...this.state.metrics.rawEvents, `${at} ${label}`].slice(-12);
    this.updateMetrics({ rawEvents });
    logDesktop(`[live-session] ${label}`);
  }

  async getState() {
    return { ...this.state };
  }

  async syncRuntimeContext(
    summary,
    { guardActive = false, force = false } = {}
  ) {
    const normalizedSummary = normalizeHintText(summary);
    const summaryChanged = normalizedSummary !== this.lastRuntimeContextSummary;
    const guardChanged = Boolean(guardActive) !== this.runtimeGuardActive;

    this.lastRuntimeContextSummary = normalizedSummary;
    this.runtimeGuardActive = Boolean(guardActive);
    this.state = {
      ...this.state,
      runtimeContext: normalizedSummary || null,
      runtimeGuardActive: this.runtimeGuardActive
    };

    if (
      this.session &&
      typeof this.session.sendContext === "function" &&
      normalizedSummary &&
      !this.toolEnabled &&
      (force || summaryChanged)
    ) {
      this.session.sendContext(normalizedSummary);
      this.appendMetricEvent("runtime context synced");
    } else if (
      normalizedSummary &&
      this.toolEnabled &&
      (force || summaryChanged)
    ) {
      this.appendMetricEvent("runtime context stored locally");
    } else if (!summaryChanged && !guardChanged && !force) {
      return this.getState();
    }

    await this.publishState();
    return this.getState();
  }

  async connect(options = {}) {
    if (this.session || this.state.connecting) {
      return this.getState();
    }

    this.brainSessionId =
      options.brainSessionId ?? `live-voice-${Date.now()}`;
    this.state = {
      ...this.state,
      connecting: true,
      status: "connecting",
      error: null
    };
    await this.publishState();

    try {
      const model = options.model ?? SUPPORTED_LIVE_MODEL;
      const toolEnabled = supportsLiveTools(model);
      this.toolEnabled = toolEnabled;
      const sessionManagementEnabled = supportsSessionManagementFeatures(model);
      const connectConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: {
          thinkingBudget: 0
        },
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
            endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
            prefixPaddingMs: 240,
            silenceDurationMs: 100
          }
        },
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Zephyr"
            }
          }
        },
        ...(sessionManagementEnabled
          ? {
              sessionResumption: {
                handle: this.lastSessionResumptionHandle ?? undefined
              },
              contextWindowCompression: {
                triggerTokens: "24000"
              }
            }
          : {}),
        ...(toolEnabled ? { tools: [createDelegateToGeminiCliTool()] } : {}),
        systemInstruction: createPersonaInstruction({ toolEnabled })
      };
      logDesktop(
        `[live-session] connect config: ${serializeForLog(
          summarizeConnectConfig(model, connectConfig, { toolEnabled })
        )}`
      );
      this.session = await this.transport.connect({
        brainSessionId: this.brainSessionId,
        apiKey: options.apiKey,
        model,
        config: connectConfig,
        callbacks: {
          onopen: () => {
            void this.handleOpen();
          },
          onclose: (info) => {
            logDesktop(
              `[live-session] transport close: ${serializeForLog(info)}`
            );
            void this.handleClose(info?.reason);
          },
          onerror: (error) => {
            logDesktop(
              `[live-session] transport error: ${serializeForLog(error)}`
            );
            void this.handleError(error);
          },
          onevent: async (event) => {
            await this.handleEvent(event);
          }
        }
      });

      if (
        sessionManagementEnabled &&
        this.lastRuntimeContextSummary &&
        typeof this.session.sendContext === "function" &&
        !this.toolEnabled
      ) {
        this.session.sendContext(this.lastRuntimeContextSummary);
        this.appendMetricEvent("runtime context restored");
      }

      this.state = {
        ...this.state,
        runtimeContext: this.lastRuntimeContextSummary || null,
        runtimeGuardActive: this.runtimeGuardActive,
        sessionResumption: {
          ...this.state.sessionResumption,
          handle: this.lastSessionResumptionHandle,
          resumable: Boolean(this.lastSessionResumptionHandle)
        }
      };

      return this.getState();
    } catch (error) {
      this.session = null;
      this.toolEnabled = false;
      this.outputTranscriptChunks = [];
      this.runtimeOwnedTurn = false;
      this.clearRoutingHints();
      this.state = {
        ...this.state,
        connected: false,
        connecting: false,
        status: "error",
        error: normalizeError(error)
      };
      await this.publishState();
      throw error;
    }
  }

  async disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.toolEnabled = false;

    this.state = {
      ...createInitialState(),
      muted: this.state.muted,
      runtimeContext: this.lastRuntimeContextSummary || null,
      runtimeGuardActive: this.runtimeGuardActive,
      sessionResumption: {
        ...this.state.sessionResumption,
        handle: this.lastSessionResumptionHandle,
        resumable: Boolean(this.lastSessionResumptionHandle)
      }
    };
    this.outputTranscriptChunks = [];
    this.runtimeOwnedTurn = false;
    this.clearRoutingHints();
    await this.publishState();
    return this.getState();
  }

  async setMuted(muted) {
    this.state = {
      ...this.state,
      muted
    };
    await this.publishState();
    return this.getState();
  }

  async sendText(text) {
    const normalizedText = text.trim();
    if (!normalizedText || !this.session) {
      return this.getState();
    }

    this.releaseCurrentTurnOwnership();
    const eventAt = nowIso();
    await this.recordExternalUserTurn(normalizedText, eventAt);
    this.state = {
      ...this.state,
      status: "thinking",
      inputPartial: "",
      lastUserTranscript: normalizedText,
      outputTranscript: "",
      error: null
    };
    this.session.sendText(normalizedText, true);
    await this.publishState();
    return this.getState();
  }

  async recordExternalUserTurn(text, createdAt = nowIso()) {
    this.releaseCurrentTurnOwnership();
    this.outputTranscriptChunks = [];
    this.clearRoutingHints();
    this.recordRoutingHint(text);
    this.appendMetricEvent("typed turn sent", createdAt);
    this.appendLiveMessage({
      id: `typed-user-${createdAt}`,
      role: "user",
      text,
      partial: false,
      createdAt
    });
    await this.publishState();
    return this.getState();
  }

  async injectAssistantMessage(text, tone = "reply") {
    const eventAt = nowIso();
    this.outputTranscriptChunks = [];
    this.appendMetricEvent(`assistant injected (${tone})`, eventAt);
    this.appendLiveMessage({
      id: `assistant-injected-${eventAt}`,
      role: "assistant",
      text,
      partial: false,
      status: tone,
      createdAt: eventAt
    });
    this.state = {
      ...this.state,
      status: tone === "clarify" ? "waiting_user" : "listening",
      outputTranscript: "",
      error: null,
      routing:
        tone === "task_ack"
          ? {
              mode: "delegated",
              summary: "worker에게 작업을 넘겼습니다.",
              detail: text
            }
          : tone === "clarify"
            ? {
                mode: "clarify",
                summary: "실행 전에 필요한 정보를 확인 중입니다.",
                detail: text
              }
            : {
                mode: "live",
                summary: "지금은 메인 아바타가 대화 중입니다.",
                detail: text
              }
    };
    await this.publishState();
    return this.getState();
  }

  async injectSystemMessage(text, status = "info") {
    const eventAt = nowIso();
    this.appendLiveMessage({
      id: `system-${status}-${eventAt}`,
      role: "system",
      text,
      partial: false,
      status,
      createdAt: eventAt
    });
    await this.publishState();
    return this.getState();
  }

  async noteRuntimeFirstDelegation(text, source = "typed") {
    const eventAt = nowIso();
    this.appendMetricEvent(`runtime-first ${source} turn`, eventAt);
    this.state = {
      ...this.state,
      status: "thinking",
      outputTranscript: "",
      routing: {
        mode: "runtime-first",
        summary: "확인 가능한 요청이라 작업 경로로 넘겼습니다.",
        detail: text
      }
    };
    await this.injectSystemMessage(
      "확인 가능한 요청이라 작업 경로로 넘겼어요.",
      "routing"
    );
    return this.getState();
  }

  async noteBridgeDecision(summary) {
    this.appendMetricEvent(`bridge ${summary}`);
    await this.publishState();
    return this.getState();
  }

  claimCurrentTurnForRuntime() {
    this.runtimeOwnedTurn = true;
    this.pendingRuntimeOwnership = false;
    this.outputTranscriptChunks = [];
    this.currentTurnDebug.runtimeOwned = true;
    this.currentTurnDebug.pendingRuntimeOwnership = false;
  }

  releaseCurrentTurnOwnership() {
    this.runtimeOwnedTurn = false;
    this.pendingRuntimeOwnership = false;
  }

  endAudioStream() {
    this.session?.sendAudioStreamEnd?.();
    this.appendMetricEvent("audio stream end sent");
  }

  async sendToolResponses(functionResponses) {
    if (!this.session?.sendToolResponse) {
      return this.getState();
    }

    this.session.sendToolResponse({
      functionResponses
    });
    this.appendMetricEvent("tool response sent");
    await this.publishState();
    return this.getState();
  }

  async applyServerInterrupt() {
    const interruptedAt = nowIso();
    this.outputTranscriptChunks = [];
    this.clearRoutingHints();
    this.finalizeLiveMessage("assistant-current", {
      status: "interrupted"
    });
    this.appendLiveMessage({
      id: `system-${interruptedAt}`,
      role: "system",
      text: "새 발화가 감지되어 응답을 멈췄습니다.",
      partial: false,
      status: "interrupted",
      createdAt: interruptedAt
    });
    this.appendMetricEvent("server interrupt", interruptedAt);
    this.state = {
      ...this.state,
      status: "interrupted",
      outputTranscript: "",
      error: null,
      routing: {
        mode: "interrupted",
        summary: "새 발화가 감지되어 기존 응답을 멈췄습니다.",
        detail: ""
      }
    };
    await this.publishState();
    return this.getState();
  }

  sendAudioChunk(audioData, mimeType = "audio/pcm;rate=16000") {
    if (!this.session || this.state.muted) {
      return;
    }

    if (typeof this.session.sendRealtimeAudio !== "function") {
      this.state = {
        ...this.state,
        status: "error",
        error: "live session does not support realtime audio input"
      };
      void this.publishState();
      return;
    }

    this.session.sendRealtimeAudio(audioData, mimeType);
    this.state = {
      ...this.state,
      sentAudioChunkCount: this.state.sentAudioChunkCount + 1
    };
    const sentAt = nowIso();
    this.updateMetrics({
      lastAudioChunkSentAt: sentAt
    });
    if (this.state.sentAudioChunkCount === 1) {
      this.appendMetricEvent("audio chunk stream started", sentAt);
      logDesktop(
        `[live-session] first audio chunk sent: ${serializeForLog({
          mimeType,
          base64Length: audioData.length
        })}`
      );
      void this.publishState();
    } else if (this.state.sentAudioChunkCount <= 3) {
      logDesktop(
        `[live-session] audio chunk sent: ${serializeForLog({
          index: this.state.sentAudioChunkCount,
          mimeType,
          base64Length: audioData.length
        })}`
      );
    }
  }

  async handleOpen() {
    const openedAt = nowIso();
    this.beginTurnDebug();
    this.state = {
      ...this.state,
      connected: true,
      connecting: false,
      status: "listening",
      error: null
    };
    this.updateMetrics({
      connectedAt: openedAt
    });
    this.appendMetricEvent("session open", openedAt);
    await this.publishState();
  }

  async handleClose(reason) {
    logDesktop(
      `[live-session] turn summary before close: ${serializeForLog(
        this.summarizeCurrentTurnDebug()
      )}`
    );
    this.session = null;
    this.toolEnabled = false;
    this.releaseCurrentTurnOwnership();
    this.clearRoutingHints();
    const closedAt = nowIso();
    this.state = {
      ...this.state,
      connected: false,
      connecting: false,
      status: "idle",
      inputPartial: "",
      error: reason ? `closed: ${reason}` : null
    };
    this.appendMetricEvent(
      reason ? `session closed (${reason})` : "session closed",
      closedAt
    );
    await this.publishState();
  }

  async handleError(error) {
    const erroredAt = nowIso();
    this.state = {
      ...this.state,
      status: "error",
      error: normalizeError(error)
    };
    this.appendMetricEvent(`error: ${normalizeError(error)}`, erroredAt);
    await this.publishState();
  }

  async handleEvent(event) {
    switch (event.type) {
      case "raw_server_message":
        logDesktop(`[live-session] raw server: ${event.summary}`);
        await this.publishState();
        return;
      case "input_transcription_partial":
        if (!this.currentTurnDebug.startedAt) {
          this.beginTurnDebug();
        }
        this.releaseCurrentTurnOwnership();
        if (this.runtimeGuardActive && !this.toolEnabled) {
          this.pendingRuntimeOwnership = true;
        }
        this.currentTurnDebug.inputPartials += 1;
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.appendPartialBuffer(event.text);
        this.recordRoutingHint(this.currentTurnPartialBuffer);
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputPartialAt: this.state.metrics.firstInputPartialAt ?? eventAt,
            lastInputPartialAt: eventAt
          });
          this.appendMetricEvent(
            `input partial: ${event.text.slice(0, 120)}`,
            eventAt
          );
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: this.currentTurnPartialBuffer,
            partial: true
          });
        }
        this.state = {
          ...this.state,
          status: "listening",
          inputPartial: this.currentTurnPartialBuffer,
          outputTranscript: "",
          error: null,
          routing: {
            mode: "listening",
            summary: "사용자 발화를 듣고 있습니다.",
            detail: this.currentTurnPartialBuffer
          }
        };
        await this.publishState();
        return;
      case "input_transcription_final":
        if (!this.currentTurnDebug.startedAt) {
          this.beginTurnDebug();
        }
        this.currentTurnTranscriptHandled = true;
        if (this.runtimeGuardActive && !this.toolEnabled) {
          this.pendingRuntimeOwnership = true;
        }
        this.currentTurnDebug.sawInputFinal = true;
        this.currentTurnDebug.inputFinalText = event.text;
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.currentTurnPartialBuffer = normalizeHintText(event.text);
        this.recordRoutingHint(this.currentTurnPartialBuffer);
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputFinalAt: this.state.metrics.firstInputFinalAt ?? eventAt,
            lastInputFinalAt: eventAt
          });
          this.appendMetricEvent(
            `input final: ${event.text.slice(0, 120)}`,
            eventAt
          );
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: this.currentTurnPartialBuffer,
            partial: false
          });
          this.finalizeLiveMessage("user-current", {
            id: `user-${eventAt}`,
            role: "user",
            text: this.currentTurnPartialBuffer
          });
        }
        this.state = {
          ...this.state,
          status: "thinking",
          inputPartial: "",
          lastUserTranscript: this.currentTurnPartialBuffer,
          outputTranscript: "",
          error: null,
          routing: {
            mode: "thinking",
            summary: "이번 요청을 해석하고 있습니다.",
            detail: this.currentTurnPartialBuffer
          }
        };
        {
          const routingHints = [...this.currentTurnRoutingHints].sort(
            (left, right) => scoreRoutingHint(right) - scoreRoutingHint(left)
          );
          const decision = await this.onUserTranscriptFinal?.(this.currentTurnPartialBuffer, {
            routingHints,
            routingHintText: routingHints[0] ?? this.currentTurnPartialBuffer
          });
          if (isRuntimeFirstDecision(decision)) {
            logDesktop("[live-session] runtime-first voice turn claimed");
            this.claimCurrentTurnForRuntime();
            this.appendMetricEvent("runtime-first voice turn claimed");
            if (decision.assistant?.text) {
              await this.injectAssistantMessage(
                decision.assistant.text,
                decision.assistant.tone
              );
            } else {
              await this.publishState();
            }
            return;
          }
        }
        await this.publishState();
        return;
      case "output_transcription":
        this.currentTurnDebug.outputTranscriptChunks += 1;
        this.currentTurnDebug.outputTranscriptPreview =
          event.text.slice(0, 240);
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.currentTurnDebug.runtimeOwned = this.runtimeOwnedTurn;
        logDesktop(
          `[live-session] output_transcription received: pending=${this.pendingRuntimeOwnership} runtimeOwned=${this.runtimeOwnedTurn}`
        );
        if (this.pendingRuntimeOwnership && !this.runtimeOwnedTurn) {
          const claimed = await this.maybeHandleRuntimeFirstFromHints(
            "output_transcription"
          );
          if (claimed) {
            this.appendMetricEvent("suppressed live output transcription");
            return;
          }
        }
        if (this.runtimeOwnedTurn || this.pendingRuntimeOwnership) {
          this.appendMetricEvent(
            this.runtimeOwnedTurn
              ? "suppressed live output transcription"
              : "suppressed live output transcription (pending runtime route)"
          );
          return;
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputTranscriptAt:
              this.state.metrics.firstOutputTranscriptAt ?? eventAt,
            lastOutputTranscriptAt: eventAt
          });
          this.appendMetricEvent(
            `${event.finished ? "output final" : "output partial"}: ${event.text.slice(0, 120)}`,
            eventAt
          );
        }
        if (event.finished) {
          this.outputTranscriptChunks = [];
        } else {
          this.outputTranscriptChunks = [
            ...this.outputTranscriptChunks,
            event.text
          ];
        }
        const assistantTranscript = event.finished
          ? event.text
          : this.outputTranscriptChunks.join(" ");
        this.upsertLiveMessage("assistant-current", {
          role: "assistant",
          text: assistantTranscript,
          partial: !event.finished
        });
        if (event.finished) {
          this.finalizeLiveMessage("assistant-current", {
            id: `assistant-${nowIso()}`,
            role: "assistant",
            text: event.text
          });
        }
        this.state = {
          ...this.state,
          status: event.finished ? this.state.status : "thinking",
          outputTranscript: event.finished ? "" : assistantTranscript,
          error: null,
          routing: event.finished
            ? this.state.routing
            : {
                mode: "live",
                summary: "메인 아바타가 답을 만들고 있습니다.",
                detail: assistantTranscript
              }
        };
        await this.publishState();
        return;
      case "output_audio":
        this.currentTurnDebug.outputAudioChunks += 1;
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.currentTurnDebug.runtimeOwned = this.runtimeOwnedTurn;
        logDesktop(
          `[live-session] output_audio received: pending=${this.pendingRuntimeOwnership} runtimeOwned=${this.runtimeOwnedTurn}`
        );
        if (this.pendingRuntimeOwnership && !this.runtimeOwnedTurn) {
          const claimed = await this.maybeHandleRuntimeFirstFromHints(
            "output_audio"
          );
          if (claimed) {
            this.appendMetricEvent("suppressed live output audio");
            return;
          }
        }
        if (this.runtimeOwnedTurn || this.pendingRuntimeOwnership) {
          this.appendMetricEvent(
            this.runtimeOwnedTurn
              ? "suppressed live output audio"
              : "suppressed live output audio (pending runtime route)"
          );
          return;
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputAudioAt: this.state.metrics.firstOutputAudioAt ?? eventAt,
            lastOutputAudioAt: eventAt
          });
          this.appendMetricEvent("output audio chunk", eventAt);
        }
        this.state = {
          ...this.state,
          status: "speaking",
          error: null,
          routing: {
            mode: "speaking",
            summary: "메인 아바타가 응답을 말하고 있습니다.",
            detail: this.state.outputTranscript
          }
        };
        await this.publishState();
        await this.onAudioChunk?.(event);
        return;
      case "interrupted":
        this.currentTurnDebug.interrupted = true;
        this.releaseCurrentTurnOwnership();
        await this.applyServerInterrupt();
        return;
      case "waiting_for_input":
        this.currentTurnDebug.waitingForInput = true;
        this.appendMetricEvent("waiting for input");
        this.state = {
          ...this.state,
          status: "listening",
          routing: {
            mode: "waiting_input",
            summary: "다음 입력을 기다리고 있습니다.",
            detail: ""
          }
        };
        await this.publishState();
        return;
      case "tool_call":
        this.currentTurnDebug.toolCalls.push(
          ...event.functionCalls.map((call) => call.name ?? "unknown")
        );
        this.appendMetricEvent(
          `tool call: ${event.functionCalls
            .map((call) => call.name ?? "unknown")
            .join(", ")}`
        );
        if (!this.onToolCall) {
          return;
        }
        try {
          const functionResponses = await this.onToolCall(event.functionCalls);
          if (functionResponses?.length) {
            await this.sendToolResponses(functionResponses);
          }
        } catch (error) {
          const responses = event.functionCalls.map((call) => ({
            id: call.id,
            name: call.name ?? "delegate_to_gemini_cli",
            response: {
              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            }
          }));
          await this.sendToolResponses(responses);
        }
        return;
      case "tool_call_cancellation":
        this.appendMetricEvent(
          `tool call cancelled: ${event.ids.join(", ")}`
        );
        await this.publishState();
        return;
      case "session_resumption_update":
        this.lastSessionResumptionHandle = event.resumable
          ? event.newHandle ?? null
          : null;
        this.state = {
          ...this.state,
          sessionResumption: {
            resumable: Boolean(event.resumable),
            handle: event.newHandle ?? null,
            lastConsumedClientMessageIndex:
              event.lastConsumedClientMessageIndex ?? null
          }
        };
        this.appendMetricEvent(
          event.resumable
            ? "session resumption updated"
            : "session resumption unavailable"
        );
        await this.publishState();
        return;
      case "turn_complete":
        this.currentTurnDebug.turnComplete = true;
        logDesktop(
          `[live-session] turn summary: ${serializeForLog(
            this.summarizeCurrentTurnDebug()
          )}`
        );
        this.releaseCurrentTurnOwnership();
        this.clearRoutingHints();
        {
          const eventAt = nowIso();
          this.updateMetrics({
            lastTurnCompleteAt: eventAt
          });
          this.appendMetricEvent("turn complete", eventAt);
        }
        this.finalizeLiveMessage("assistant-current");
        this.state = {
          ...this.state,
          status: "listening",
          routing: {
            mode: "idle",
            summary: "다음 요청을 기다리고 있습니다.",
            detail: ""
          }
        };
        await this.publishState();
        this.beginTurnDebug();
        return;
      default:
        return;
    }
  }

  async publishState() {
    await this.onStateChange?.(await this.getState());
  }
}
