import type {
  FinalizedUtterance,
  IntentType
} from "@agent/shared-types";
import { StreamingTranscriptAccumulator } from "../modules/live/streaming-transcript-accumulator.js";

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
  private readonly accumulator = new StreamingTranscriptAccumulator();

  async handleTranscriptChunk(input: {
    brainSessionId: string;
    chunk: NoopLiveTranscriptChunk;
  }): Promise<NoopLiveTranscriptResult> {
    const transcript = this.accumulator.handleChunk({
      sessionKey: input.brainSessionId,
      text: input.chunk.text,
      isFinal: input.chunk.isFinal
    });
    const finalizedText = transcript.finalizedText ?? "";

    if (!input.chunk.isFinal) {
      return {
        partialText: transcript.partialText
      };
    }

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
    this.accumulator.resetSession(brainSessionId);
  }

  clearPartial(brainSessionId: string): void {
    this.accumulator.clearPartial(brainSessionId);
  }
}
