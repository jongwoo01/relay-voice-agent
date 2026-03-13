import { GoogleLiveApiTransport } from "@agent/agent-api";
import { ActivityHandling, Behavior, Modality, Type } from "@google/genai";
import { logDesktop } from "../debug/desktop-log.js";

function resolveSupportedLiveModel() {
  return process.env.LIVE_MODEL?.trim() ?? "gemini-live-2.5-flash-preview";
}

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
    rawEvents: [],
  };
}

function createTurnDebug() {
  return {
    startedAt: null,
    inputPartials: 0,
    sawInputFinal: false,
    inputFinalText: "",
    latestHeardText: "",
    localTaskCueDetected: false,
    outputTranscriptChunks: 0,
    outputTranscriptPreview: "",
    outputAudioChunks: 0,
    toolCalls: [],
    toolResponseCount: 0,
    suppressedLiveOutput: 0,
    missedToolOpportunity: false,
    runtimeOwned: false,
    pendingRuntimeOwnership: false,
    waitingForInput: false,
    interrupted: false,
    turnComplete: false,
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
    conversationTimeline: [],
    conversationTurns: [],
    activeTurnId: null,
    routing: {
      mode: "idle",
      summary: "아직 확인 중인 요청이 없습니다.",
      detail: "",
    },
    runtimeContext: null,
    runtimeGuardActive: false,
    sessionResumption: {
      resumable: false,
      handle: null,
      lastConsumedClientMessageIndex: null,
    },
    metrics: createMetrics(),
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
    "You are Desktop Companion, a desktop voice assistant.",
    "Never guess or invent facts about the world, the local machine, or the result of any task.",
    "Do not claim that any action was completed, changed, verified, or successful unless it was explicitly confirmed by runtime state, a tool result, or an executor result.",
    "Report task progress, completion, and failure only when grounded in runtime state, task state, tool results, or executor results.",
    "If something is uncertain or not yet verified, say that clearly instead of implying success.",
    "When the user asks about the local machine or the result of a local action, check first or rely on the task/result flow before stating specifics.",
  ];

  if (toolEnabled) {
    lines.splice(
      1,
      0,
      "When local-machine work, task follow-up, or task status is needed, call delegate_to_gemini_cli instead of answering from memory.",
    );
  } else {
    lines.splice(
      1,
      0,
      "When local-machine work, task follow-up, or task status is needed, say you will check first and rely on the runtime task flow instead of answering from memory.",
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
                "Natural-language request to pass to the Gemini CLI runtime.",
            },
          },
          required: ["request"],
        },
      },
    ],
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

function serializeForLog(value) {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
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

function looksLikeLocalTaskCue(text) {
  return /(바탕화면|데스크톱|다운로드|폴더|파일|브라우저|탭|앱|workspace|프로젝트|작업|이어서|결과|상태|어디까지|완료|저장해|만들어|생성해|정리해|찾아줘|확인해줘|txt|진짜|정말|for real|really|seriously|왜|아니|아닌데|틀렸|잘못|다시|retry|recheck|redo|delete|삭제|지우|create|i told you|i said|not what|wait|hold on)/i.test(
    text,
  );
}

function parseRawServerSummary(summary) {
  if (typeof summary !== "string" || !summary.trim()) {
    return null;
  }

  try {
    return JSON.parse(summary);
  } catch {
    return null;
  }
}

function isAudioOnlyServerSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  const modelParts = Array.isArray(summary.modelParts) ? summary.modelParts : [];
  if (modelParts.length === 0) {
    return false;
  }

  const hasOnlyInlineData = modelParts.every(
    (part) =>
      part &&
      typeof part === "object" &&
      part.inlineData &&
      typeof part.inlineData === "object" &&
      !("text" in part),
  );

  return (
    hasOnlyInlineData &&
    !summary.setupComplete &&
    !summary.inputText &&
    !summary.inputFinished &&
    !summary.outputText &&
    !summary.outputFinished &&
    !summary.interrupted &&
    !summary.waitingForInput &&
    !summary.turnComplete &&
    !summary.sessionResumptionUpdate &&
    !summary.goAway &&
    (!Array.isArray(summary.toolCalls) || summary.toolCalls.length === 0) &&
    (!Array.isArray(summary.toolCallCancellationIds) ||
      summary.toolCallCancellationIds.length === 0)
  );
}

function getAudioOnlyServerBytes(summary) {
  if (!Array.isArray(summary?.modelParts)) {
    return 0;
  }

  return summary.modelParts.reduce((total, part) => {
    const length = Number(part?.inlineData?.dataLength ?? 0);
    return Number.isFinite(length) ? total + length : total;
  }, 0);
}

function isTranscriptOnlyServerSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  const hasNoModelParts =
    !Array.isArray(summary.modelParts) || summary.modelParts.length === 0;

  return (
    hasNoModelParts &&
    !summary.setupComplete &&
    !summary.inputText &&
    !summary.inputFinished &&
    typeof summary.outputText === "string" &&
    !summary.interrupted &&
    !summary.waitingForInput &&
    !summary.turnComplete &&
    !summary.sessionResumptionUpdate &&
    !summary.goAway &&
    (!Array.isArray(summary.toolCalls) || summary.toolCalls.length === 0) &&
    (!Array.isArray(summary.toolCallCancellationIds) ||
      summary.toolCallCancellationIds.length === 0)
  );
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
      config.tools?.flatMap(
        (tool) =>
          tool.functionDeclarations?.map(
            (declaration) => declaration.name ?? "unknown",
          ) ?? [],
      ) ?? [],
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
      normalized,
    )
  ) {
    score += 50;
  }
  if (
    /알려줘|보여줘|찾아줘|정리해줘|실행|요약해줘|개수|갯수|몇 개|무슨|뭐가|보이니|있니/i.test(
      normalized,
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
    normalized,
  );
}

export class LiveVoiceSession {
  constructor(options = {}) {
    this.transport = options.transport ?? new GoogleLiveApiTransport();
    this.onStateChange = options.onStateChange;
    this.onAudioChunk = options.onAudioChunk;
    this.onUserTranscriptFinal = options.onUserTranscriptFinal;
    this.onToolCall = options.onToolCall;
    this.onDebugEvent = options.onDebugEvent;
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
    this.turnSequence = 0;
    this.currentTurnInputMode = null;
    this.currentTurnResponseSource = "live";
    this.firstServerMessageSeen = false;
    this.firstSetupCompleteSeen = false;
    this.lastLiveErrorSignature = null;
    this.audioOnlyServerChunkCount = 0;
    this.audioOnlyServerTotalBytes = 0;
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
        (candidate) => candidate !== normalized,
      ),
      normalized,
    ].slice(-6);
    this.pendingRuntimeOwnership =
      !this.toolEnabled &&
      this.currentTurnRoutingHints.some(looksLikeForcedRuntimeHint);
    if (this.pendingRuntimeOwnership) {
      logDesktop(
        `[live-session] runtime-first hint armed: ${this.currentTurnRoutingHints.at(-1)}`,
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

  flushAudioOnlyServerAggregate(reason = "summary") {
    if (this.audioOnlyServerChunkCount === 0) {
      return;
    }

    this.audioOnlyServerChunkCount = 0;
    this.audioOnlyServerTotalBytes = 0;
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
      latestHeardText: this.currentTurnDebug.latestHeardText,
      localTaskCueDetected: this.currentTurnDebug.localTaskCueDetected,
      outputTranscriptChunks: this.currentTurnDebug.outputTranscriptChunks,
      outputTranscriptPreview: this.currentTurnDebug.outputTranscriptPreview,
      outputAudioChunks: this.currentTurnDebug.outputAudioChunks,
      toolCalls: this.currentTurnDebug.toolCalls,
      toolCallCount: this.currentTurnDebug.toolCalls.length,
      toolResponseCount: this.currentTurnDebug.toolResponseCount,
      suppressedLiveOutput: this.currentTurnDebug.suppressedLiveOutput,
      missedToolOpportunity: this.currentTurnDebug.missedToolOpportunity,
      runtimeOwned: this.currentTurnDebug.runtimeOwned,
      pendingRuntimeOwnership: this.currentTurnDebug.pendingRuntimeOwnership,
      waitingForInput: this.currentTurnDebug.waitingForInput,
      interrupted: this.currentTurnDebug.interrupted,
      turnComplete: this.currentTurnDebug.turnComplete,
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

  createTurnId(prefix, createdAt = nowIso()) {
    this.turnSequence += 1;
    return `${prefix}-${createdAt}-${this.turnSequence}`;
  }

  ensureActiveTurn(inputMode, createdAt = nowIso()) {
    if (
      this.state.activeTurnId &&
      this.currentTurnInputMode === inputMode &&
      this.state.conversationTurns.some(
        (turn) => turn.turnId === this.state.activeTurnId,
      )
    ) {
      return this.state.activeTurnId;
    }

    const turnId = this.createTurnId(inputMode, createdAt);
    this.currentTurnInputMode = inputMode;
    this.currentTurnResponseSource = inputMode === "typed" ? "runtime" : "live";
    this.state = {
      ...this.state,
      activeTurnId: turnId,
      conversationTurns: [
        ...this.state.conversationTurns,
        {
          turnId,
          inputMode,
          stage: inputMode === "voice" ? "capturing" : "thinking",
          startedAt: createdAt,
          updatedAt: createdAt,
        },
      ],
    };

    return turnId;
  }

  updateConversationTurn(turnId, patch) {
    const existingIndex = this.state.conversationTurns.findIndex(
      (turn) => turn.turnId === turnId,
    );

    if (existingIndex === -1) {
      const timestamp = patch.updatedAt ?? patch.startedAt ?? nowIso();
      this.state = {
        ...this.state,
        conversationTurns: [
          ...this.state.conversationTurns,
          {
            turnId,
            inputMode: this.currentTurnInputMode ?? "voice",
            startedAt: patch.startedAt ?? timestamp,
            updatedAt: patch.updatedAt ?? timestamp,
            ...patch,
          },
        ],
      };
      return;
    }

    const turns = [...this.state.conversationTurns];
    turns[existingIndex] = {
      ...turns[existingIndex],
      ...patch,
      startedAt: turns[existingIndex].startedAt ?? patch.startedAt ?? nowIso(),
      updatedAt: patch.updatedAt ?? nowIso(),
    };
    this.state = {
      ...this.state,
      conversationTurns: turns,
    };
  }

  upsertConversationTimelineItem(id, patch) {
    const existingIndex = this.state.conversationTimeline.findIndex(
      (item) => item.id === id,
    );

    if (existingIndex === -1) {
      this.state = {
        ...this.state,
        conversationTimeline: [
          ...this.state.conversationTimeline,
          {
            id,
            partial: false,
            streaming: false,
            interrupted: false,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            ...patch,
          },
        ].slice(-80),
      };
      return;
    }

    const items = [...this.state.conversationTimeline];
    items[existingIndex] = {
      ...items[existingIndex],
      ...patch,
      createdAt: items[existingIndex].createdAt ?? patch.createdAt ?? nowIso(),
      updatedAt: patch.updatedAt ?? nowIso(),
    };
    this.state = {
      ...this.state,
      conversationTimeline: items,
    };
  }

  finalizeConversationTimelineItem(id, patch = {}) {
    this.upsertConversationTimelineItem(id, {
      partial: false,
      streaming: false,
      ...patch,
    });
  }

  clearActiveTurn() {
    this.state = {
      ...this.state,
      activeTurnId: null,
    };
    this.currentTurnInputMode = null;
    this.currentTurnResponseSource = "live";
  }

  async maybeHandleRuntimeFirstFromHints(reason) {
    if (this.toolEnabled) {
      return false;
    }

    if (this.currentTurnTranscriptHandled || !this.pendingRuntimeOwnership) {
      logDesktop(
        `[live-session] runtime-first skipped from ${reason}: handled=${this.currentTurnTranscriptHandled} pending=${this.pendingRuntimeOwnership}`,
      );
      return false;
    }

    if (this.runtimeOwnershipDecisionInFlight) {
      this.appendMetricEvent(`runtime-first already in flight from ${reason}`);
      logDesktop(
        `[live-session] runtime-first already in flight from ${reason}`,
      );
      return true;
    }

    const routingHints = [...this.currentTurnRoutingHints].sort(
      (left, right) => scoreRoutingHint(right) - scoreRoutingHint(left),
    );
    const routingHintText =
      routingHints[0] ||
      this.currentTurnPartialBuffer ||
      this.state.lastUserTranscript;

    if (!routingHintText) {
      logDesktop(
        `[live-session] runtime-first skipped from ${reason}: no routing hint text`,
      );
      return false;
    }

    this.runtimeOwnershipDecisionInFlight = true;
    try {
      this.appendMetricEvent(
        `runtime-first check from ${reason}: ${routingHintText}`,
      );
      const decision = await this.onUserTranscriptFinal?.(routingHintText, {
        routingHints,
        routingHintText,
        inferredFromPartial: true,
      });

      this.currentTurnTranscriptHandled = true;
      logDesktop(
        `[live-session] runtime-first decision from ${reason}: ${decision?.mode ?? "none"}`,
      );

      if (isRuntimeFirstDecision(decision)) {
        this.claimCurrentTurnForRuntime();
        this.appendMetricEvent("runtime-first voice turn claimed");
        if (decision.assistant?.text) {
          await this.injectAssistantMessage(
            decision.assistant.text,
            decision.assistant.tone,
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
      liveMessages: [...this.state.liveMessages, message].slice(-30),
    };
  }

  upsertLiveMessage(id, patch) {
    const existingIndex = this.state.liveMessages.findIndex(
      (message) => message.id === id,
    );

    if (existingIndex === -1) {
      this.appendLiveMessage({
        id,
        createdAt: nowIso(),
        ...patch,
      });
      return;
    }

    const nextMessages = [...this.state.liveMessages];
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      ...patch,
    };
    this.state = {
      ...this.state,
      liveMessages: nextMessages,
    };
  }

  finalizeLiveMessage(id, patch = {}) {
    const existingIndex = this.state.liveMessages.findIndex(
      (message) => message.id === id,
    );
    if (existingIndex === -1) {
      return;
    }

    const nextMessages = [...this.state.liveMessages];
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      partial: false,
      ...patch,
    };
    this.state = {
      ...this.state,
      liveMessages: nextMessages,
    };
  }

  updateMetrics(patch) {
    this.state = {
      ...this.state,
      metrics: {
        ...this.state.metrics,
        ...patch,
      },
    };
  }

  appendMetricEvent(label, at = nowIso()) {
    if (label === "output audio chunk") {
      return;
    }
    const rawEvents = [...this.state.metrics.rawEvents, `${at} ${label}`].slice(
      -12,
    );
    this.updateMetrics({ rawEvents });
    logDesktop(`[live-session] ${label}`);
    this.onDebugEvent?.({
      source: "live",
      kind: label,
      summary: label,
      createdAt: at,
      turnId: this.state.activeTurnId ?? undefined,
    });
  }

  async getState() {
    return { ...this.state };
  }

  async syncRuntimeContext(
    summary,
    { guardActive = false, force = false } = {},
  ) {
    const normalizedSummary = normalizeHintText(summary);
    const summaryChanged = normalizedSummary !== this.lastRuntimeContextSummary;
    const guardChanged = Boolean(guardActive) !== this.runtimeGuardActive;

    this.lastRuntimeContextSummary = normalizedSummary;
    this.runtimeGuardActive = Boolean(guardActive);
    this.state = {
      ...this.state,
      runtimeContext: normalizedSummary || null,
      runtimeGuardActive: this.runtimeGuardActive,
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

    this.brainSessionId = options.brainSessionId ?? `live-voice-${Date.now()}`;
    this.state = {
      ...this.state,
      connecting: true,
      status: "connecting",
      error: null,
    };
    await this.publishState();
    logDesktop("[live-session] connect start");

    try {
      const model = options.model ?? resolveSupportedLiveModel();
      const toolEnabled = supportsLiveTools(model);
      this.toolEnabled = toolEnabled;
      const sessionManagementEnabled = supportsSessionManagementFeatures(model);
      const connectConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: {
          thinkingBudget: 0,
        },
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
            endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
            prefixPaddingMs: 240,
            silenceDurationMs: 100,
          },
        },
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Zephyr",
            },
          },
        },
        ...(sessionManagementEnabled
          ? {
              sessionResumption: {
                handle: this.lastSessionResumptionHandle ?? undefined,
              },
              contextWindowCompression: {
                triggerTokens: "24000",
              },
            }
          : {}),
        ...(toolEnabled ? { tools: [createDelegateToGeminiCliTool()] } : {}),
        systemInstruction: createPersonaInstruction({ toolEnabled }),
      };
      logDesktop(
        `[live-session] connect config: ${serializeForLog(
          summarizeConnectConfig(model, connectConfig, { toolEnabled }),
        )}`,
      );
      this.firstServerMessageSeen = false;
      this.firstSetupCompleteSeen = false;
      this.lastLiveErrorSignature = null;
      this.audioOnlyServerChunkCount = 0;
      this.audioOnlyServerTotalBytes = 0;
      this.session = await this.transport.connect({
        brainSessionId: this.brainSessionId,
        model,
        config: connectConfig,
        callbacks: {
          onopen: () => {
            logDesktop("[live-session] transport onopen");
            void this.handleOpen();
          },
          onclose: (info) => {
            logDesktop(
              `[live-session] transport onclose: ${serializeForLog(info)}`,
            );
            void this.handleClose(info?.reason);
          },
          onerror: (error) => {
            logDesktop(
              `[live-session] transport onerror: ${serializeForLog(error)}`,
            );
            void this.handleError(error);
          },
          onevent: async (event) => {
            await this.handleEvent(event);
          },
        },
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
          resumable: Boolean(this.lastSessionResumptionHandle),
        },
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
        error: normalizeError(error),
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
        resumable: Boolean(this.lastSessionResumptionHandle),
      },
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
      muted,
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
      error: null,
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
    const turnId = this.ensureActiveTurn("typed", createdAt);
    const userMessageId = `${turnId}:user`;
    this.upsertConversationTimelineItem(userMessageId, {
      turnId,
      kind: "user_message",
      inputMode: "typed",
      speaker: "user",
      text,
      partial: false,
      streaming: false,
      interrupted: false,
      createdAt,
      updatedAt: createdAt,
    });
    this.updateConversationTurn(turnId, {
      inputMode: "typed",
      stage: "thinking",
      userMessageId,
    });
    this.appendMetricEvent("typed turn sent", createdAt);
    this.appendLiveMessage({
      id: `typed-user-${createdAt}`,
      role: "user",
      text,
      partial: false,
      createdAt,
    });
    await this.publishState();
    return this.getState();
  }

  async injectAssistantMessage(text, tone = "reply") {
    const eventAt = nowIso();
    const turnId = this.ensureActiveTurn(
      this.currentTurnInputMode ?? "voice",
      eventAt,
    );
    this.outputTranscriptChunks = [];
    this.appendMetricEvent(`assistant injected (${tone})`, eventAt);
    const responseSource =
      tone === "task_ack"
        ? "delegate"
        : (this.currentTurnResponseSource ?? "runtime");
    const assistantMessageId = `${turnId}:assistant`;
    this.upsertConversationTimelineItem(assistantMessageId, {
      turnId,
      kind: "assistant_message",
      inputMode: this.currentTurnInputMode ?? "voice",
      speaker: "assistant",
      text,
      partial: false,
      streaming: false,
      interrupted: false,
      tone,
      responseSource,
      createdAt: eventAt,
      updatedAt: eventAt,
    });
    this.updateConversationTurn(turnId, {
      inputMode: this.currentTurnInputMode ?? "voice",
      stage:
        tone === "clarify"
          ? "waiting_input"
          : tone === "task_ack"
            ? "delegated"
            : "completed",
      assistantMessageId,
    });
    this.appendLiveMessage({
      id: `assistant-injected-${eventAt}`,
      role: "assistant",
      text,
      partial: false,
      status: tone,
      createdAt: eventAt,
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
              summary: "task runner에게 작업을 넘겼습니다.",
              detail: text,
            }
          : tone === "clarify"
            ? {
                mode: "clarify",
                summary: "실행 전에 필요한 정보를 확인 중입니다.",
                detail: text,
              }
            : {
                mode: "live",
                summary: "지금은 메인 아바타가 대화 중입니다.",
                detail: text,
              },
    };
    this.clearActiveTurn();
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
      createdAt: eventAt,
    });
    await this.publishState();
    return this.getState();
  }

  async noteRuntimeFirstDelegation(text, source = "typed") {
    const eventAt = nowIso();
    const turnId = this.ensureActiveTurn(
      source === "typed" ? "typed" : "voice",
      eventAt,
    );
    this.currentTurnResponseSource = "runtime";
    this.appendMetricEvent(`runtime-first ${source} turn`, eventAt);
    this.updateConversationTurn(turnId, {
      stage: "delegated",
    });
    this.state = {
      ...this.state,
      status: "thinking",
      outputTranscript: "",
      routing: {
        mode: "runtime-first",
        summary: "확인 가능한 요청이라 작업 경로로 넘겼습니다.",
        detail: text,
      },
    };
    this.onDebugEvent?.({
      source: "bridge",
      kind: "runtime_first",
      summary: `routed ${source} turn through runtime-first`,
      detail: text,
      createdAt: eventAt,
      turnId,
    });
    await this.publishState();
    return this.getState();
  }

  async noteBridgeDecision(summary) {
    const createdAt = nowIso();
    logDesktop(`[live-brain-bridge] ${summary}`);
    this.onDebugEvent?.({
      source: "bridge",
      kind: "decision",
      summary,
      createdAt,
      turnId: this.state.activeTurnId ?? undefined,
    });
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

    this.currentTurnDebug.toolResponseCount += functionResponses.length;
    const firstOutput = functionResponses.find(
      (response) => response?.response?.output,
    )?.response?.output;
    if (firstOutput) {
      this.currentTurnResponseSource = "delegate";
      if (this.state.activeTurnId) {
        this.updateConversationTurn(this.state.activeTurnId, {
          stage:
            firstOutput.status === "waiting_input" ||
            firstOutput.status === "approval_required"
              ? "waiting_input"
              : firstOutput.status === "failed"
                ? "failed"
                : "delegated",
          taskId: firstOutput.taskId ?? undefined,
        });
      }
    }
    logDesktop(
      `[live-session] tool responses prepared: ${serializeForLog(
        functionResponses.map((response) => ({
          id: response.id,
          name: response.name,
          willContinue: response.willContinue ?? false,
          scheduling: response.scheduling ?? null,
          output: {
            action: response.response?.output?.action ?? null,
            accepted: response.response?.output?.accepted ?? null,
            taskId: response.response?.output?.taskId ?? null,
            status: response.response?.output?.status ?? null,
            failureReason: response.response?.output?.failureReason ?? null,
            message:
              typeof response.response?.output?.message === "string"
                ? response.response.output.message.slice(0, 160)
                : null,
          },
        })),
      )}`,
    );
    this.session.sendToolResponse({
      functionResponses,
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
      status: "interrupted",
    });
    if (this.state.activeTurnId) {
      this.finalizeConversationTimelineItem(
        `${this.state.activeTurnId}:assistant`,
        {
          interrupted: true,
          updatedAt: interruptedAt,
        },
      );
      this.updateConversationTurn(this.state.activeTurnId, {
        stage: "completed",
      });
    }
    this.appendMetricEvent("server interrupt", interruptedAt);
    this.state = {
      ...this.state,
      status: "interrupted",
      outputTranscript: "",
      error: null,
      routing: {
        mode: "interrupted",
        summary: "새 발화가 감지되어 기존 응답을 멈췄습니다.",
        detail: "",
      },
    };
    this.clearActiveTurn();
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
        error: "live session does not support realtime audio input",
      };
      void this.publishState();
      return;
    }

    this.session.sendRealtimeAudio(audioData, mimeType);
    this.state = {
      ...this.state,
      sentAudioChunkCount: this.state.sentAudioChunkCount + 1,
    };
    const sentAt = nowIso();
    this.updateMetrics({
      lastAudioChunkSentAt: sentAt,
    });
    if (this.state.sentAudioChunkCount === 1) {
      this.appendMetricEvent("audio chunk stream started", sentAt);
      logDesktop(
        `[live-session] first audio chunk sent: ${serializeForLog({
          mimeType,
          base64Length: audioData.length,
        })}`,
      );
      void this.publishState();
    } else if (this.state.sentAudioChunkCount <= 3) {
      logDesktop(
        `[live-session] audio chunk sent: ${serializeForLog({
          index: this.state.sentAudioChunkCount,
          mimeType,
          base64Length: audioData.length,
        })}`,
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
      error: null,
    };
    this.updateMetrics({
      connectedAt: openedAt,
    });
    this.appendMetricEvent("session open", openedAt);
    await this.publishState();
  }

  async handleClose(reason) {
    logDesktop(
      `[live-session] turn summary before close: ${serializeForLog(
        this.summarizeCurrentTurnDebug(),
      )}`,
    );
    this.session = null;
    this.toolEnabled = false;
    this.releaseCurrentTurnOwnership();
    this.clearRoutingHints();
    this.firstServerMessageSeen = false;
    this.firstSetupCompleteSeen = false;
    this.lastLiveErrorSignature = null;
    this.audioOnlyServerChunkCount = 0;
    this.audioOnlyServerTotalBytes = 0;
    const closedAt = nowIso();
    this.state = {
      ...this.state,
      connected: false,
      connecting: false,
      status: "idle",
      inputPartial: "",
      error: reason ? `closed: ${reason}` : null,
    };
    this.appendMetricEvent(
      reason ? `session closed (${reason})` : "session closed",
      closedAt,
    );
    await this.publishState();
  }

  async handleError(error) {
    const erroredAt = nowIso();
    if (!this.firstServerMessageSeen) {
      logDesktop("[live-session] error arrived before first server message");
    }
    this.state = {
      ...this.state,
      status: "error",
      error: normalizeError(error),
    };
    this.appendMetricEvent(`error: ${normalizeError(error)}`, erroredAt);
    await this.publishState();
  }

  async handleEvent(event) {
    switch (event.type) {
      case "raw_server_message":
        {
          const parsedSummary = parseRawServerSummary(event.summary);
          if (isAudioOnlyServerSummary(parsedSummary)) {
            this.audioOnlyServerChunkCount += 1;
            this.audioOnlyServerTotalBytes += getAudioOnlyServerBytes(parsedSummary);
            return;
          }
          if (isTranscriptOnlyServerSummary(parsedSummary)) {
            if (!this.firstServerMessageSeen) {
              this.firstServerMessageSeen = true;
              logDesktop(`[live-session] first server message: ${event.summary}`);
            }
            return;
          }
          this.flushAudioOnlyServerAggregate();
          if (!this.firstServerMessageSeen) {
            this.firstServerMessageSeen = true;
            logDesktop(`[live-session] first server message: ${event.summary}`);
          }
          if (parsedSummary?.setupComplete && !this.firstSetupCompleteSeen) {
            this.firstSetupCompleteSeen = true;
            logDesktop("[live-session] setupComplete seen");
          }
          if (parsedSummary?.sessionResumptionUpdate) {
            logDesktop(
              `[live-session] sessionResumptionUpdate seen: ${serializeForLog(
                parsedSummary.sessionResumptionUpdate,
              )}`,
            );
          }
          logDesktop(`[live-session] raw server: ${event.summary}`);
        }
        this.onDebugEvent?.({
          source: "transport",
          kind: "raw_server_message",
          summary: "raw server message",
          detail: event.summary,
          createdAt: nowIso(),
          turnId: this.state.activeTurnId ?? undefined,
        });
        await this.publishState();
        return;
      case "live_error": {
        const signature = `${event.code ?? ""}:${event.message ?? ""}`;
        if (this.lastLiveErrorSignature !== signature) {
          this.lastLiveErrorSignature = signature;
          logDesktop(
            `[live-session] live error event: ${serializeForLog({
              code: event.code ?? null,
              message: event.message ?? null,
              raw: event.raw,
            })}`,
          );
          this.onDebugEvent?.({
            source: "transport",
            kind: "live_error",
            summary: `live error${event.code ? ` (${event.code})` : ""}`,
            detail: serializeForLog(event.raw),
            createdAt: nowIso(),
            turnId: this.state.activeTurnId ?? undefined,
          });
        }
        await this.publishState();
        return;
      }
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
        this.currentTurnDebug.latestHeardText = this.currentTurnPartialBuffer;
        this.currentTurnDebug.localTaskCueDetected =
          this.currentTurnDebug.localTaskCueDetected ||
          looksLikeLocalTaskCue(this.currentTurnPartialBuffer);
        this.recordRoutingHint(this.currentTurnPartialBuffer);
        {
          const eventAt = nowIso();
          const turnId = this.ensureActiveTurn("voice", eventAt);
          const userMessageId = `${turnId}:user`;
          this.upsertConversationTimelineItem(userMessageId, {
            turnId,
            kind: "user_message",
            inputMode: "voice",
            speaker: "user",
            text: this.currentTurnPartialBuffer,
            partial: true,
            streaming: false,
            interrupted: false,
            createdAt: eventAt,
            updatedAt: eventAt,
          });
          this.updateConversationTurn(turnId, {
            inputMode: "voice",
            stage: "capturing",
            userMessageId,
          });
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputPartialAt:
              this.state.metrics.firstInputPartialAt ?? eventAt,
            lastInputPartialAt: eventAt,
          });
          this.appendMetricEvent(
            `input partial: ${event.text.slice(0, 120)}`,
            eventAt,
          );
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: this.currentTurnPartialBuffer,
            partial: true,
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
            detail: this.currentTurnPartialBuffer,
          },
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
        this.currentTurnDebug.latestHeardText = this.currentTurnPartialBuffer;
        this.currentTurnDebug.localTaskCueDetected =
          this.currentTurnDebug.localTaskCueDetected ||
          looksLikeLocalTaskCue(this.currentTurnPartialBuffer);
        this.recordRoutingHint(this.currentTurnPartialBuffer);
        {
          const eventAt = nowIso();
          const turnId = this.ensureActiveTurn("voice", eventAt);
          const userMessageId = `${turnId}:user`;
          this.finalizeConversationTimelineItem(userMessageId, {
            turnId,
            kind: "user_message",
            inputMode: "voice",
            speaker: "user",
            text: this.currentTurnPartialBuffer,
            partial: false,
            streaming: false,
            interrupted: false,
            createdAt: eventAt,
            updatedAt: eventAt,
          });
          this.updateConversationTurn(turnId, {
            inputMode: "voice",
            stage: "thinking",
            userMessageId,
          });
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputFinalAt: this.state.metrics.firstInputFinalAt ?? eventAt,
            lastInputFinalAt: eventAt,
          });
          this.appendMetricEvent(
            `input final: ${event.text.slice(0, 120)}`,
            eventAt,
          );
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: this.currentTurnPartialBuffer,
            partial: false,
          });
          this.finalizeLiveMessage("user-current", {
            id: `user-${eventAt}`,
            role: "user",
            text: this.currentTurnPartialBuffer,
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
            detail: this.currentTurnPartialBuffer,
          },
        };
        {
          const routingHints = [...this.currentTurnRoutingHints].sort(
            (left, right) => scoreRoutingHint(right) - scoreRoutingHint(left),
          );
          const decision = await this.onUserTranscriptFinal?.(
            this.currentTurnPartialBuffer,
            {
              routingHints,
              routingHintText: routingHints[0] ?? this.currentTurnPartialBuffer,
            },
          );
          if (isRuntimeFirstDecision(decision)) {
            logDesktop("[live-session] runtime-first voice turn claimed");
            this.claimCurrentTurnForRuntime();
            this.appendMetricEvent("runtime-first voice turn claimed");
            if (decision.assistant?.text) {
              await this.injectAssistantMessage(
                decision.assistant.text,
                decision.assistant.tone,
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
        this.currentTurnDebug.outputTranscriptPreview = event.text.slice(
          0,
          240,
        );
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.currentTurnDebug.runtimeOwned = this.runtimeOwnedTurn;
        if (
          event.finished ||
          this.currentTurnDebug.outputTranscriptChunks === 1 ||
          this.currentTurnDebug.outputTranscriptChunks % 4 === 0
        ) {
          logDesktop(
            `[live-session] output_transcription received: ${serializeForLog({
              chunks: this.currentTurnDebug.outputTranscriptChunks,
              finished: event.finished,
              pending: this.pendingRuntimeOwnership,
              runtimeOwned: this.runtimeOwnedTurn,
            })}`,
          );
        }
        if (this.pendingRuntimeOwnership && !this.runtimeOwnedTurn) {
          const claimed = await this.maybeHandleRuntimeFirstFromHints(
            "output_transcription",
          );
          if (claimed) {
            this.appendMetricEvent("suppressed live output transcription");
            this.currentTurnDebug.suppressedLiveOutput += 1;
            return;
          }
        }
        if (this.runtimeOwnedTurn || this.pendingRuntimeOwnership) {
          this.currentTurnDebug.suppressedLiveOutput += 1;
          this.appendMetricEvent(
            this.runtimeOwnedTurn
              ? "suppressed live output transcription"
              : "suppressed live output transcription (pending runtime route)",
          );
          return;
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputTranscriptAt:
              this.state.metrics.firstOutputTranscriptAt ?? eventAt,
            lastOutputTranscriptAt: eventAt,
          });
          if (
            event.finished ||
            this.currentTurnDebug.outputTranscriptChunks === 1 ||
            this.currentTurnDebug.outputTranscriptChunks % 4 === 0
          ) {
            this.appendMetricEvent(
              `${event.finished ? "output final" : "output partial"}: ${event.text.slice(0, 120)}`,
              eventAt,
            );
          }
        }
        if (event.finished) {
          this.outputTranscriptChunks = [];
        } else {
          this.outputTranscriptChunks = [
            ...this.outputTranscriptChunks,
            event.text,
          ];
        }
        const assistantTranscript = event.finished
          ? event.text
          : this.outputTranscriptChunks.join(" ");
        {
          const eventAt = nowIso();
          const turnId = this.ensureActiveTurn(
            this.currentTurnInputMode ?? "voice",
            eventAt,
          );
          const assistantMessageId = `${turnId}:assistant`;
          this.upsertConversationTimelineItem(assistantMessageId, {
            turnId,
            kind: "assistant_message",
            inputMode: this.currentTurnInputMode ?? "voice",
            speaker: "assistant",
            text: assistantTranscript,
            partial: !event.finished,
            streaming: !event.finished,
            interrupted: false,
            responseSource: this.currentTurnResponseSource ?? "live",
            createdAt: eventAt,
            updatedAt: eventAt,
          });
          this.updateConversationTurn(turnId, {
            inputMode: this.currentTurnInputMode ?? "voice",
            stage: event.finished ? "completed" : "responding",
            assistantMessageId,
          });
          if (event.finished) {
            this.currentTurnResponseSource = "live";
          }
        }
        this.upsertLiveMessage("assistant-current", {
          role: "assistant",
          text: assistantTranscript,
          partial: !event.finished,
        });
        if (event.finished) {
          this.finalizeLiveMessage("assistant-current", {
            id: `assistant-${nowIso()}`,
            role: "assistant",
            text: event.text,
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
                detail: assistantTranscript,
              },
        };
        await this.publishState();
        return;
      case "output_audio":
        this.currentTurnDebug.outputAudioChunks += 1;
        this.currentTurnDebug.pendingRuntimeOwnership =
          this.pendingRuntimeOwnership;
        this.currentTurnDebug.runtimeOwned = this.runtimeOwnedTurn;
        if (this.pendingRuntimeOwnership && !this.runtimeOwnedTurn) {
          const claimed =
            await this.maybeHandleRuntimeFirstFromHints("output_audio");
          if (claimed) {
            this.appendMetricEvent("suppressed live output audio");
            this.currentTurnDebug.suppressedLiveOutput += 1;
            return;
          }
        }
        if (this.runtimeOwnedTurn || this.pendingRuntimeOwnership) {
          this.currentTurnDebug.suppressedLiveOutput += 1;
          this.appendMetricEvent(
            this.runtimeOwnedTurn
              ? "suppressed live output audio"
              : "suppressed live output audio (pending runtime route)",
          );
          return;
        }
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputAudioAt:
              this.state.metrics.firstOutputAudioAt ?? eventAt,
            lastOutputAudioAt: eventAt,
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
            detail: this.state.outputTranscript,
          },
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
        if (this.state.activeTurnId) {
          this.updateConversationTurn(this.state.activeTurnId, {
            stage: "waiting_input",
          });
        }
        this.state = {
          ...this.state,
          status: "listening",
          routing: {
            mode: "waiting_input",
            summary: "다음 입력을 기다리고 있습니다.",
            detail: "",
          },
        };
        await this.publishState();
        return;
      case "tool_call":
        this.currentTurnDebug.toolCalls.push(
          ...event.functionCalls.map((call) => call.name ?? "unknown"),
        );
        this.currentTurnResponseSource = "delegate";
        if (this.state.activeTurnId) {
          this.updateConversationTurn(this.state.activeTurnId, {
            stage: "delegated",
          });
        }
        this.appendMetricEvent(
          `tool call: ${event.functionCalls
            .map((call) => call.name ?? "unknown")
            .join(", ")}`,
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
              error: error instanceof Error ? error.message : String(error),
            },
          }));
          await this.sendToolResponses(responses);
        }
        return;
      case "tool_call_cancellation":
        this.appendMetricEvent(`tool call cancelled: ${event.ids.join(", ")}`);
        await this.publishState();
        return;
      case "session_resumption_update":
        this.lastSessionResumptionHandle = event.resumable
          ? (event.newHandle ?? null)
          : null;
        this.onDebugEvent?.({
          source: "transport",
          kind: "session_resumption_update",
          summary: event.resumable
            ? "session resumption updated"
            : "session resumption unavailable",
          detail:
            event.newHandle ??
            event.lastConsumedClientMessageIndex ??
            undefined,
          createdAt: nowIso(),
        });
        this.state = {
          ...this.state,
          sessionResumption: {
            resumable: Boolean(event.resumable),
            handle: event.newHandle ?? null,
            lastConsumedClientMessageIndex:
              event.lastConsumedClientMessageIndex ?? null,
          },
        };
        this.appendMetricEvent(
          event.resumable
            ? "session resumption updated"
            : "session resumption unavailable",
        );
        await this.publishState();
        return;
      case "turn_complete":
        this.flushAudioOnlyServerAggregate("turn_complete");
        this.currentTurnDebug.turnComplete = true;
        this.currentTurnDebug.missedToolOpportunity =
          this.currentTurnDebug.localTaskCueDetected &&
          this.currentTurnDebug.toolCalls.length === 0 &&
          !this.currentTurnDebug.runtimeOwned &&
          !this.currentTurnDebug.pendingRuntimeOwnership;
        if (this.currentTurnDebug.missedToolOpportunity) {
          logDesktop(
            `[live-session] missed tool opportunity: ${serializeForLog({
              latestHeardText: this.currentTurnDebug.latestHeardText,
              outputTranscriptPreview:
                this.currentTurnDebug.outputTranscriptPreview,
            })}`,
          );
        }
        logDesktop(
          `[live-session] turn summary: ${serializeForLog(
            this.summarizeCurrentTurnDebug(),
          )}`,
        );
        this.releaseCurrentTurnOwnership();
        this.clearRoutingHints();
        {
          const eventAt = nowIso();
          this.updateMetrics({
            lastTurnCompleteAt: eventAt,
          });
          this.appendMetricEvent("turn complete", eventAt);
        }
        this.finalizeLiveMessage("assistant-current");
        if (this.state.activeTurnId) {
          this.finalizeConversationTimelineItem(
            `${this.state.activeTurnId}:assistant`,
            {
              partial: false,
              streaming: false,
            },
          );
          this.updateConversationTurn(this.state.activeTurnId, {
            stage: this.currentTurnDebug.waitingForInput
              ? "waiting_input"
              : "completed",
          });
        }
        this.state = {
          ...this.state,
          status: "listening",
          routing: {
            mode: "idle",
            summary: "다음 요청을 기다리고 있습니다.",
            detail: "",
          },
        };
        await this.publishState();
        this.clearActiveTurn();
        this.beginTurnDebug();
        return;
      case "go_away":
        this.onDebugEvent?.({
          source: "transport",
          kind: "go_away",
          summary: "transport requested shutdown",
          detail: event.timeLeft ?? undefined,
          createdAt: nowIso(),
        });
        await this.publishState();
        return;
      default:
        return;
    }
  }

  async publishState() {
    await this.onStateChange?.(await this.getState());
  }
}
