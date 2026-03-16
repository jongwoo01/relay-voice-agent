import {
  type Content,
  type FunctionCall,
  type FunctionResponse,
  type LiveCallbacks,
  type LiveConnectConfig,
  type LiveServerMessage
} from "@google/genai";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  LiveSessionController,
  type LiveSessionTurnResult
} from "./live-session-controller.js";
import {
  extractVertexAiFailureDetail
} from "../config/vertex-ai-config.js";
import { DEFAULT_GEMINI_LIVE_MODEL } from "../config/gemini-api-config.js";
import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";

export function resolveDefaultLiveModel(): string {
  return process.env.LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL;
}

export const DEFAULT_LIVE_MODEL = resolveDefaultLiveModel();

function isLiveTransportDebugEnabled(): boolean {
  return process.env.LIVE_INPUT_DEBUG?.trim() === "1";
}

export type GoogleLiveTransportEvent =
  | { type: "raw_server_message"; summary: string }
  | { type: "live_error"; code?: string; message?: string; raw: unknown }
  | { type: "input_transcription_partial"; text: string; rawText: string }
  | {
      type: "input_transcription_final";
      text: string;
      utterance?: FinalizedUtterance;
      turn?: LiveSessionTurnResult;
    }
  | { type: "output_audio"; data: string; mimeType: string }
  | { type: "model_text"; text: string }
  | { type: "output_transcription"; text: string; finished: boolean }
  | { type: "tool_call"; functionCalls: FunctionCall[] }
  | { type: "tool_call_cancellation"; ids: string[] }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "waiting_for_input" }
  | {
      type: "session_resumption_update";
      newHandle?: string;
      resumable?: boolean;
      lastConsumedClientMessageIndex?: string;
    }
  | { type: "go_away"; timeLeft?: string };

export interface GoogleLiveCloseInfo {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export interface GoogleLiveApiTransportCallbacks {
  onopen?: () => void;
  onclose?: (info: GoogleLiveCloseInfo) => void;
  onerror?: (error: unknown) => void;
  onevent?: (event: GoogleLiveTransportEvent) => void | Promise<void>;
}

export interface GoogleLiveApiTransportConnectInput {
  brainSessionId: string;
  model?: string;
  config?: LiveConnectConfig;
  callbacks?: GoogleLiveApiTransportCallbacks;
}

export interface GoogleLiveSessionTransport {
  sendText(text: string, turnComplete?: boolean): void;
  sendContext(text: string): void;
  sendToolResponse(params: {
    functionResponses: FunctionResponse | FunctionResponse[];
  }): void;
  sendRealtimeText(text: string): void;
  sendRealtimeAudio(audioData: string, mimeType?: string): void;
  sendActivityStart(): void;
  sendActivityEnd(): void;
  sendAudioStreamEnd(): void;
  clearInputTranscriptPartial(): void;
  close(): void;
}

export interface GoogleLiveSdkSessionLike {
  sendClientContent(params: { turns: Content[]; turnComplete?: boolean }): void;
  sendToolResponse(params: {
    functionResponses: FunctionResponse | FunctionResponse[];
  }): void;
  sendRealtimeInput(params: {
    text?: string;
    audio?: { data: string; mimeType: string };
    media?: { data: string; mimeType: string };
    activityStart?: Record<string, never>;
    activityEnd?: Record<string, never>;
    audioStreamEnd?: boolean;
  }): void;
  close(): void;
}

export interface GoogleLiveApiClientLike {
  live: {
    connect(params: {
      model: string;
      config?: LiveConnectConfig;
      callbacks: LiveCallbacks;
    }): Promise<GoogleLiveSdkSessionLike>;
  };
}

export interface LiveTranscriptControllerLike {
  handleTranscriptChunk(input: {
    brainSessionId: string;
    chunk: {
      text: string;
      createdAt: string;
      isFinal: boolean;
    };
    now: string;
  }): Promise<{
    partialText?: string;
    finalizedUtterance?: FinalizedUtterance;
    assistant?: LiveSessionTurnResult["assistant"];
    task?: LiveSessionTurnResult["task"];
    taskEvents?: LiveSessionTurnResult["taskEvents"];
    executorSession?: LiveSessionTurnResult["executorSession"];
  }>;
  clearPartial(brainSessionId: string): void;
  resetSession(brainSessionId: string): void;
}

function collectInputTranscriptionText(message: LiveServerMessage): string | undefined {
  const text = message.serverContent?.inputTranscription?.text;
  return typeof text === "string" ? text : undefined;
}

function collectOutputTranscriptionText(message: LiveServerMessage): string | undefined {
  const text = message.serverContent?.outputTranscription?.text;
  return typeof text === "string" ? text : undefined;
}

function collectModelText(message: LiveServerMessage): string | undefined {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  const plainText = parts
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  return plainText ? plainText : undefined;
}

function collectOutputAudioParts(
  message: LiveServerMessage
): Array<{ data: string; mimeType: string }> {
  const parts = message.serverContent?.modelTurn?.parts ?? [];

  return parts.flatMap((part) => {
    if (
      "inlineData" in part &&
      part.inlineData &&
      typeof part.inlineData.data === "string" &&
      typeof part.inlineData.mimeType === "string"
    ) {
      return [
        {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType
        }
      ];
    }

    return [];
  });
}

function summarizeServerMessage(message: LiveServerMessage): string {
  const summary = {
    setupComplete: message.setupComplete ?? false,
    inputText: message.serverContent?.inputTranscription?.text ?? null,
    inputFinished: message.serverContent?.inputTranscription?.finished ?? null,
    outputText: message.serverContent?.outputTranscription?.text ?? null,
    outputFinished: message.serverContent?.outputTranscription?.finished ?? null,
    modelParts: (message.serverContent?.modelTurn?.parts ?? []).map((part) => {
      if ("text" in part && typeof part.text === "string") {
        return { text: part.text };
      }
      if ("inlineData" in part && part.inlineData) {
        return {
          inlineData: {
            mimeType: part.inlineData.mimeType,
            dataLength:
              typeof part.inlineData.data === "string"
                ? part.inlineData.data.length
                : 0
          }
        };
      }
      return { unknown: true };
    }),
    interrupted: message.serverContent?.interrupted ?? false,
    waitingForInput: message.serverContent?.waitingForInput ?? false,
    turnComplete: message.serverContent?.turnComplete ?? false,
    toolCalls:
      message.toolCall?.functionCalls?.map((call) => ({
        id: call.id ?? null,
        name: call.name ?? null
      })) ?? [],
    toolCallCancellationIds: message.toolCallCancellation?.ids ?? [],
    usageMetadata: message.usageMetadata ?? null,
    sessionResumptionUpdate: message.sessionResumptionUpdate
      ? {
          newHandle: message.sessionResumptionUpdate.newHandle ?? null,
          resumable: message.sessionResumptionUpdate.resumable ?? null,
          lastConsumedClientMessageIndex:
            message.sessionResumptionUpdate.lastConsumedClientMessageIndex ?? null
        }
      : null,
    goAway: message.goAway ?? null
  };

  return JSON.stringify(summary);
}

function extractLiveErrorInfo(event: unknown): {
  code?: string;
  message?: string;
  raw: unknown;
} {
  const candidate =
    event && typeof event === "object" && "error" in event
      ? (event as { error?: unknown }).error ?? event
      : event;
  const rawCode =
    candidate &&
    typeof candidate === "object" &&
    "code" in candidate &&
    (typeof (candidate as { code?: unknown }).code === "string" ||
      typeof (candidate as { code?: unknown }).code === "number")
      ? (candidate as { code?: string | number }).code
      : undefined;
  const rawMessage =
    candidate &&
    typeof candidate === "object" &&
    "message" in candidate &&
    typeof (candidate as { message?: unknown }).message === "string"
      ? (candidate as { message: string }).message
      : candidate instanceof Error
        ? candidate.message
        : typeof candidate === "string"
          ? candidate
          : undefined;

  return {
    code:
      typeof rawCode === "number"
        ? String(rawCode)
        : typeof rawCode === "string"
          ? rawCode
          : undefined,
    message: rawMessage,
    raw: candidate
  };
}

function serializeForLog(value: unknown): string {
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

export class GoogleLiveApiTransport {
  constructor(
    private readonly controller: LiveTranscriptControllerLike = new LiveSessionController(),
    private readonly aiFactory: (() => GoogleLiveApiClientLike) | GenAiClientFactory = () =>
      createDefaultGenAiClientFactory().createLiveClient()
  ) {}

  async connect(
    input: GoogleLiveApiTransportConnectInput
  ): Promise<GoogleLiveSessionTransport> {
    let session: GoogleLiveSdkSessionLike;
    const runtimeMetadata =
      "getRuntimeMetadata" in this.aiFactory ? this.aiFactory.getRuntimeMetadata() : null;
    try {
      const ai =
        "createLiveClient" in this.aiFactory
          ? this.aiFactory.createLiveClient()
          : this.aiFactory();
      session = await ai.live.connect({
        model: input.model ?? resolveDefaultLiveModel(),
        config: input.config,
        callbacks: {
          onopen: () => {
            input.callbacks?.onopen?.();
          },
          onmessage: (message) => {
            void this.handleServerMessage(
              input.brainSessionId,
              message,
              input.callbacks
            ).catch((error) => {
              input.callbacks?.onerror?.(error);
            });
          },
          onerror: (event) => {
            const liveError = extractLiveErrorInfo(event);
            const maybeEventPromise = input.callbacks?.onevent?.({
                type: "live_error",
                code: liveError.code,
                message: liveError.message,
                raw: liveError.raw
              });
            if (maybeEventPromise && "catch" in maybeEventPromise) {
              void maybeEventPromise.catch((error) => {
                input.callbacks?.onerror?.(error);
              });
            }
            input.callbacks?.onerror?.(liveError);
          },
          onclose: (event) => {
            this.controller.resetSession(input.brainSessionId);
            input.callbacks?.onclose?.({
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean
            });
          }
        }
      });
    } catch (error) {
      const detail = extractVertexAiFailureDetail(error);
      const liveBackend = runtimeMetadata?.liveBackend ?? "gemini_api";
      const wrappedMessage = detail.message?.trim()
        ? `${
            liveBackend === "gemini_api"
              ? "Gemini Live connection failed"
              : "Vertex AI live connection failed"
          }: ${detail.message.trim()}`
        : liveBackend === "gemini_api"
          ? "Gemini Live connection failed."
          : "Vertex AI live connection failed.";
      console.error(
        `[google-live-api-transport] connect failed ${serializeForLog({
          reason: detail.reason,
          code: detail.code,
          rawCode: detail.rawCode ?? null,
          message: detail.message,
          liveBackend
        })}`
      );
      throw new Error(wrappedMessage, { cause: error });
    }

    return {
      sendText(text: string, turnComplete = true) {
        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text }]
            }
          ],
          turnComplete
        });
      },
      sendContext(text: string) {
        const normalizedText = text.trim();
        if (!normalizedText) {
          return;
        }

        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text: `[Runtime context]\n${normalizedText}` }]
            }
          ],
          turnComplete: false
        });
      },
      sendToolResponse(params) {
        session.sendToolResponse(params);
      },
      sendRealtimeText(text: string) {
        session.sendRealtimeInput({ text });
      },
      sendRealtimeAudio(audioData: string, mimeType = "audio/pcm;rate=16000") {
        session.sendRealtimeInput({
          audio: {
            data: audioData,
            mimeType
          }
        });
      },
      sendActivityStart() {
        session.sendRealtimeInput({
          activityStart: {}
        });
      },
      sendActivityEnd() {
        session.sendRealtimeInput({
          activityEnd: {}
        });
      },
      sendAudioStreamEnd() {
        session.sendRealtimeInput({
          audioStreamEnd: true
        });
      },
      clearInputTranscriptPartial: () => {
        this.controller.clearPartial(input.brainSessionId);
      },
      close() {
        session.close();
      }
    };
  }

  private async handleServerMessage(
    brainSessionId: string,
    message: LiveServerMessage,
    callbacks?: GoogleLiveApiTransportCallbacks
  ): Promise<void> {
    const inputText = collectInputTranscriptionText(message);
    const summary = summarizeServerMessage(message);
    let summaryData: {
      inputText: string | null;
      outputText: string | null;
      waitingForInput: boolean;
      turnComplete: boolean;
      interrupted: boolean;
    } | null = null;

    if (isLiveTransportDebugEnabled()) {
      try {
        summaryData = JSON.parse(summary) as {
          inputText: string | null;
          outputText: string | null;
          waitingForInput: boolean;
          turnComplete: boolean;
          interrupted: boolean;
        };
      } catch {
        summaryData = null;
      }
    }

    if (isLiveTransportDebugEnabled()) {
      const hasInterestingPayload =
        summaryData?.inputText !== null ||
        summaryData?.outputText !== null ||
        summaryData?.waitingForInput === true ||
        summaryData?.turnComplete === true ||
        summaryData?.interrupted === true;
      if (hasInterestingPayload) {
        console.log(
          `[live-input][transport] server message session=${brainSessionId} ${summary}`
        );
      }
    }

    await callbacks?.onevent?.({
      type: "raw_server_message",
      summary
    });

    if (inputText !== undefined) {
      const finished = message.serverContent?.inputTranscription?.finished === true;
      const turn = await this.controller.handleTranscriptChunk({
        brainSessionId,
        chunk: {
          text: inputText,
          createdAt: new Date().toISOString(),
          isFinal: finished
        },
        now: new Date().toISOString()
      });

      await callbacks?.onevent?.(
        finished
          ? {
              type: "input_transcription_final",
              text: turn.finalizedUtterance?.text ?? inputText,
              utterance: turn.finalizedUtterance,
              turn
            }
          : {
              type: "input_transcription_partial",
              text: turn.partialText ?? inputText,
              rawText: inputText
            }
      );
    }

    const outputText = collectOutputTranscriptionText(message);
    if (outputText !== undefined) {
      await callbacks?.onevent?.({
        type: "output_transcription",
        text: outputText,
        finished: message.serverContent?.outputTranscription?.finished === true
      });
    }

    const modelText = collectModelText(message);
    if (modelText) {
      await callbacks?.onevent?.({
        type: "model_text",
        text: modelText
      });
    }

    for (const audioPart of collectOutputAudioParts(message)) {
      await callbacks?.onevent?.({
        type: "output_audio",
        data: audioPart.data,
        mimeType: audioPart.mimeType
      });
    }

    if (message.serverContent?.interrupted) {
      await callbacks?.onevent?.({ type: "interrupted" });
    }

    if (message.serverContent?.waitingForInput) {
      await callbacks?.onevent?.({ type: "waiting_for_input" });
    }

    if (message.serverContent?.turnComplete) {
      await callbacks?.onevent?.({ type: "turn_complete" });
    }

    if ((message.toolCall?.functionCalls?.length ?? 0) > 0) {
      await callbacks?.onevent?.({
        type: "tool_call",
        functionCalls: message.toolCall?.functionCalls ?? []
      });
    }

    if ((message.toolCallCancellation?.ids?.length ?? 0) > 0) {
      await callbacks?.onevent?.({
        type: "tool_call_cancellation",
        ids: message.toolCallCancellation?.ids ?? []
      });
    }

    if (message.sessionResumptionUpdate) {
      await callbacks?.onevent?.({
        type: "session_resumption_update",
        newHandle: message.sessionResumptionUpdate.newHandle,
        resumable: message.sessionResumptionUpdate.resumable,
        lastConsumedClientMessageIndex:
          message.sessionResumptionUpdate.lastConsumedClientMessageIndex
      });
    }

    if (message.goAway) {
      await callbacks?.onevent?.({
        type: "go_away",
        timeLeft: message.goAway.timeLeft
      });
    }
  }
}
