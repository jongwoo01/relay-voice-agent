import {
  GoogleGenAI,
  type Content,
  type LiveCallbacks,
  type LiveConnectConfig,
  type LiveServerMessage
} from "@google/genai";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  LiveSessionController,
  type LiveSessionTurnResult
} from "./live-session-controller.js";

export const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export type GoogleLiveTransportEvent =
  | { type: "raw_server_message"; summary: string }
  | { type: "input_transcription_partial"; text: string }
  | {
      type: "input_transcription_final";
      text: string;
      utterance?: FinalizedUtterance;
      turn?: LiveSessionTurnResult;
    }
  | { type: "output_audio"; data: string; mimeType: string }
  | { type: "model_text"; text: string }
  | { type: "output_transcription"; text: string; finished: boolean }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "waiting_for_input" }
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
  apiKey?: string;
  brainSessionId: string;
  model?: string;
  config?: LiveConnectConfig;
  callbacks?: GoogleLiveApiTransportCallbacks;
}

export interface GoogleLiveSessionTransport {
  sendText(text: string, turnComplete?: boolean): void;
  sendRealtimeText(text: string): void;
  sendRealtimeAudio(audioData: string, mimeType?: string): void;
  sendActivityStart(): void;
  sendActivityEnd(): void;
  sendAudioStreamEnd(): void;
  close(): void;
}

export interface GoogleLiveSdkSessionLike {
  sendClientContent(params: { turns: Content[]; turnComplete?: boolean }): void;
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

function collectInputTranscriptionText(message: LiveServerMessage): string | undefined {
  const text = message.serverContent?.inputTranscription?.text?.trim();
  return text ? text : undefined;
}

function collectOutputTranscriptionText(message: LiveServerMessage): string | undefined {
  const text = message.serverContent?.outputTranscription?.text?.trim();
  return text ? text : undefined;
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
    goAway: message.goAway ?? null
  };

  return JSON.stringify(summary);
}

export class GoogleLiveApiTransport {
  constructor(
    private readonly controller: LiveSessionController = new LiveSessionController(),
    private readonly aiFactory: (apiKey: string) => GoogleLiveApiClientLike = (apiKey) =>
      new GoogleGenAI({ apiKey })
  ) {}

  async connect(
    input: GoogleLiveApiTransportConnectInput
  ): Promise<GoogleLiveSessionTransport> {
    const apiKey = input.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Google Live API transport requires an API key");
    }

    const ai = this.aiFactory(apiKey);
    const session = await ai.live.connect({
      model: input.model ?? DEFAULT_LIVE_MODEL,
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
          input.callbacks?.onerror?.(event.error ?? event);
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

    await callbacks?.onevent?.({
      type: "raw_server_message",
      summary: summarizeServerMessage(message)
    });

    if (inputText) {
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
              text: inputText,
              utterance: turn.finalizedUtterance,
              turn
            }
          : {
              type: "input_transcription_partial",
              text: turn.partialText ?? inputText
            }
      );
    }

    const outputText = collectOutputTranscriptionText(message);
    if (outputText) {
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

    if (message.goAway) {
      await callbacks?.onevent?.({
        type: "go_away",
        timeLeft: message.goAway.timeLeft
      });
    }
  }
}
