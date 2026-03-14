import type {
  FinalizedUtterance,
  IntentType
} from "@agent/shared-types";

export interface NoopLiveTranscriptChunk {
  text: string;
  createdAt: string;
  isFinal: boolean;
  intentHint?: IntentType;
}

export interface NoopLiveTranscriptResult {
  partialText?: string;
  finalizedUtterance?: FinalizedUtterance;
}

export class NoopLiveSessionController {
  private readonly partialBySession = new Map<string, string>();

  async handleTranscriptChunk(input: {
    brainSessionId: string;
    chunk: NoopLiveTranscriptChunk;
  }): Promise<NoopLiveTranscriptResult> {
    const text = input.chunk.text.trim();

    if (!input.chunk.isFinal) {
      if (text) {
        this.partialBySession.set(input.brainSessionId, text);
      }

      return {
        partialText: this.partialBySession.get(input.brainSessionId) ?? text
      };
    }

    const finalizedText =
      text || this.partialBySession.get(input.brainSessionId)?.trim() || "";
    this.partialBySession.delete(input.brainSessionId);

    if (!finalizedText) {
      return {};
    }

    return {
      finalizedUtterance: {
        text: finalizedText,
        intent: input.chunk.intentHint ?? "small_talk",
        createdAt: input.chunk.createdAt
      }
    };
  }

  resetSession(brainSessionId: string): void {
    this.partialBySession.delete(brainSessionId);
  }
}
