import {
  GoogleLiveApiTransport
} from "@agent/agent-api";
import { ActivityHandling, Modality } from "@google/genai";
import { logDesktop } from "../debug/desktop-log.js";

const SUPPORTED_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

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
    metrics: createMetrics()
  };
}

function createPersonaInstruction() {
  return [
    "You are Desktop Companion, a lively desktop voice assistant.",
    "Keep responses short, playful, and helpful.",
    "Most replies should be one sentence, and never exceed two short sentences.",
    "React with quick confidence first, then add one useful detail if needed.",
    "If the user asks about the current state of local files, folders, apps, browser tabs, or anything on this machine, never guess or invent specifics.",
    "For local-machine questions, say you will check first, then wait for the task/result flow instead of pretending you already know the answer.",
    "Do not claim that files were moved, renamed, deleted, summarized, or organized unless the task/executor result explicitly confirmed it.",
    "If the user interrupts, stop cleanly and pivot to the new request immediately.",
    "For task acknowledgements, sound upbeat and brief.",
    "For task completion, say what finished, the result in one line, and one suggested next step."
  ].join(" ");
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
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
    this.pendingRuntimeOwnership = this.currentTurnRoutingHints.some(
      looksLikeForcedRuntimeHint
    );
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
      this.session = await this.transport.connect({
        brainSessionId: this.brainSessionId,
        apiKey: options.apiKey,
        model: options.model ?? SUPPORTED_LIVE_MODEL,
        config: {
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
          systemInstruction: createPersonaInstruction()
        },
        callbacks: {
          onopen: () => {
            void this.handleOpen();
          },
          onclose: (info) => {
            void this.handleClose(info?.reason);
          },
          onerror: (error) => {
            void this.handleError(error);
          },
          onevent: async (event) => {
            await this.handleEvent(event);
          }
        }
      });

      return this.getState();
    } catch (error) {
      this.session = null;
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

    this.state = {
      ...createInitialState(),
      muted: this.state.muted
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
  }

  releaseCurrentTurnOwnership() {
    this.runtimeOwnedTurn = false;
    this.pendingRuntimeOwnership = false;
  }

  endAudioStream() {
    this.session?.sendAudioStreamEnd?.();
    this.appendMetricEvent("audio stream end sent");
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
      void this.publishState();
    }
  }

  async handleOpen() {
    const openedAt = nowIso();
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
    this.session = null;
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
        await this.publishState();
        return;
      case "input_transcription_partial":
        this.releaseCurrentTurnOwnership();
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
        this.currentTurnTranscriptHandled = true;
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
        this.releaseCurrentTurnOwnership();
        await this.applyServerInterrupt();
        return;
      case "waiting_for_input":
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
      case "turn_complete":
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
        return;
      default:
        return;
    }
  }

  async publishState() {
    await this.onStateChange?.(await this.getState());
  }
}
