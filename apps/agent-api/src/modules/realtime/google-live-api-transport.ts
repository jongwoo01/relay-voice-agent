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
  | { type: "input_transcription_partial"; text: string }
  | {
      type: "input_transcription_final";
      text: string;
      utterance?: FinalizedUtterance;
      turn?: LiveSessionTurnResult;
    }
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
  close(): void;
}

export interface GoogleLiveSdkSessionLike {
  sendClientContent(params: { turns: Content[]; turnComplete?: boolean }): void;
  sendRealtimeInput(params: { text: string }): void;
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
