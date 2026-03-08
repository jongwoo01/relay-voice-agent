import {
  GoogleLiveApiTransport
} from "@agent/agent-api";
import { Modality } from "@google/genai";

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
    metrics: createMetrics()
  };
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function nowIso() {
  return new Date().toISOString();
}

export class LiveVoiceSession {
  constructor(options = {}) {
    this.transport = options.transport ?? new GoogleLiveApiTransport();
    this.onStateChange = options.onStateChange;
    this.onAudioChunk = options.onAudioChunk;
    this.state = options.state ?? createInitialState();
    this.session = null;
    this.brainSessionId = null;
    this.outputTranscriptChunks = [];
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
    const rawEvents = [...this.state.metrics.rawEvents, `${at} ${label}`].slice(-12);
    this.updateMetrics({ rawEvents });
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
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 20,
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
          systemInstruction:
            "You are a concise live desktop voice preview. Keep answers short, natural, and conversational."
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

  sendText(text) {
    this.session?.sendText(text, true);
    void this.publishState();
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
      status: "live",
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
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputPartialAt: this.state.metrics.firstInputPartialAt ?? eventAt,
            lastInputPartialAt: eventAt
          });
          this.appendMetricEvent("input transcription partial", eventAt);
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: event.text,
            partial: true
          });
        }
        this.state = {
          ...this.state,
          inputPartial: event.text,
          error: null
        };
        await this.publishState();
        return;
      case "input_transcription_final":
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstInputFinalAt: this.state.metrics.firstInputFinalAt ?? eventAt,
            lastInputFinalAt: eventAt
          });
          this.appendMetricEvent("input transcription final", eventAt);
          this.upsertLiveMessage("user-current", {
            role: "user",
            text: event.text,
            partial: false
          });
          this.finalizeLiveMessage("user-current", {
            id: `user-${eventAt}`,
            role: "user",
            text: event.text
          });
        }
        this.state = {
          ...this.state,
          inputPartial: "",
          lastUserTranscript: event.text,
          error: null
        };
        await this.publishState();
        return;
      case "output_transcription":
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputTranscriptAt:
              this.state.metrics.firstOutputTranscriptAt ?? eventAt,
            lastOutputTranscriptAt: eventAt
          });
          this.appendMetricEvent(
            event.finished
              ? "output transcription final"
              : "output transcription partial",
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
          outputTranscript: assistantTranscript,
          error: null
        };
        await this.publishState();
        return;
      case "output_audio":
        {
          const eventAt = nowIso();
          this.updateMetrics({
            firstOutputAudioAt: this.state.metrics.firstOutputAudioAt ?? eventAt,
            lastOutputAudioAt: eventAt
          });
          this.appendMetricEvent("output audio chunk", eventAt);
        }
        await this.onAudioChunk?.(event);
        return;
      case "interrupted":
        this.appendMetricEvent("turn interrupted");
        this.appendLiveMessage({
          id: `system-${nowIso()}`,
          role: "system",
          text: "응답이 중단되었습니다.",
          partial: false
        });
        this.state = {
          ...this.state,
          status: "interrupted"
        };
        await this.publishState();
        return;
      case "waiting_for_input":
        this.appendMetricEvent("waiting for input");
        this.state = {
          ...this.state,
          status: "listening"
        };
        await this.publishState();
        return;
      case "turn_complete":
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
          status: "live"
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
