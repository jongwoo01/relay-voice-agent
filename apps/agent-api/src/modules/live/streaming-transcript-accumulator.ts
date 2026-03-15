import { mergeStreamingTranscript } from "./transcript-merge.js";

function isStreamingTranscriptDebugEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export interface StreamingTranscriptChunk {
  sessionKey: string;
  text: string;
  isFinal: boolean;
}

export interface StreamingTranscriptChunkResult {
  partialText?: string;
  finalizedText?: string;
}

export class StreamingTranscriptAccumulator {
  private readonly partialBySession = new Map<string, string>();
  private readonly lastFinalBySession = new Map<string, string>();

  handleChunk(input: StreamingTranscriptChunk): StreamingTranscriptChunkResult {
    const existingPartial = this.partialBySession.get(input.sessionKey) ?? "";
    const isFreshTurn = !existingPartial;
    const rawText = this.stripRepeatedFinalPrefix(
      input.sessionKey,
      typeof input.text === "string" ? input.text : "",
      isFreshTurn,
      existingPartial
    );
    const normalizedText = rawText.trim();

    if (!input.isFinal) {
      const previousPartial = this.partialBySession.get(input.sessionKey) ?? "";
      const mergedPartial =
        rawText.length > 0
          ? mergeStreamingTranscript(previousPartial, rawText)
          : previousPartial;

      if (rawText.length > 0) {
        this.partialBySession.set(input.sessionKey, mergedPartial);
      }

      if (isStreamingTranscriptDebugEnabled()) {
        console.log(
          `[live-input][accumulator] partial session=${input.sessionKey} raw=${JSON.stringify(rawText)} merged=${JSON.stringify(mergedPartial)}`
        );
      }

      return {
        partialText: mergedPartial || this.partialBySession.get(input.sessionKey)
      };
    }

    const previousPartial = this.partialBySession.get(input.sessionKey)?.trim() ?? "";
    this.partialBySession.delete(input.sessionKey);
    const finalizedText = this.resolveFinalizedText(
      input.sessionKey,
      previousPartial,
      normalizedText
    );

    if (finalizedText) {
      this.lastFinalBySession.set(input.sessionKey, finalizedText);
      if (isStreamingTranscriptDebugEnabled()) {
        console.log(
          `[live-input][accumulator] final session=${input.sessionKey} previousPartial=${JSON.stringify(previousPartial)} normalized=${JSON.stringify(normalizedText)} finalized=${JSON.stringify(finalizedText)}`
        );
      }
      return { finalizedText };
    }

    if (isStreamingTranscriptDebugEnabled()) {
      console.log(
        `[live-input][accumulator] final-empty session=${input.sessionKey} previousPartial=${JSON.stringify(previousPartial)} normalized=${JSON.stringify(normalizedText)}`
      );
    }

    return {};
  }

  getPartialText(sessionKey: string): string | undefined {
    return this.partialBySession.get(sessionKey);
  }

  clearPartial(sessionKey: string): void {
    this.partialBySession.delete(sessionKey);
  }

  resetSession(sessionKey: string): void {
    this.clearPartial(sessionKey);
    this.lastFinalBySession.delete(sessionKey);
  }

  private resolveFinalizedText(
    sessionKey: string,
    previousPartial: string,
    normalizedText: string
  ): string {
    if (!normalizedText) {
      return previousPartial;
    }

    if (!previousPartial) {
      return normalizedText;
    }

    const previousLower = previousPartial.toLowerCase();
    const strippedFinal = this.stripRepeatedFinalPrefix(
      sessionKey,
      normalizedText,
      true,
      previousPartial
    ).trim();
    if (strippedFinal && strippedFinal !== normalizedText) {
      const strippedLower = strippedFinal.toLowerCase();
      if (strippedLower.startsWith(previousLower)) {
        return strippedFinal;
      }
      if (previousLower.startsWith(strippedLower) || strippedLower.includes(previousLower)) {
        return previousPartial;
      }
    }

    const normalizedLower = normalizedText.toLowerCase();

    if (
      normalizedLower.includes(previousLower) ||
      previousLower.includes(normalizedLower)
    ) {
      return normalizedText;
    }

    return mergeStreamingTranscript(previousPartial, normalizedText).trim();
  }

  private stripRepeatedFinalPrefix(
    sessionKey: string,
    rawText: string,
    isFreshTurn: boolean,
    existingPartial: string
  ): string {
    const lastFinal = this.lastFinalBySession.get(sessionKey)?.trim();
    if (!lastFinal) {
      return rawText;
    }

    const sanitizedPartial = existingPartial.trim();
    if (!isFreshTurn && sanitizedPartial.toLowerCase().startsWith(lastFinal.toLowerCase())) {
      return rawText;
    }

    const leadingWhitespace = rawText.match(/^\s*/)?.[0] ?? "";
    const content = rawText.slice(leadingWhitespace.length);
    if (!content || content.length <= lastFinal.length) {
      return rawText;
    }

    if (!content.toLowerCase().startsWith(lastFinal.toLowerCase())) {
      return rawText;
    }

    const remainder = content.slice(lastFinal.length).trimStart();
    if (!remainder) {
      return rawText;
    }

    if (!this.shouldStripCarryOver(lastFinal, remainder)) {
      return rawText;
    }

    if (isStreamingTranscriptDebugEnabled()) {
      console.log(
        `[live-input][accumulator] strip carry-over session=${sessionKey} lastFinal=${JSON.stringify(lastFinal)} remainder=${JSON.stringify(remainder)}`
      );
    }

    return `${leadingWhitespace}${remainder}`;
  }

  private shouldStripCarryOver(lastFinal: string, remainder: string): boolean {
    const trimmedFinal = lastFinal.trim();
    const hasSentenceBoundary = /[.!?。！？]$/.test(trimmedFinal);
    const hasMultipleWords = trimmedFinal.split(/\s+/).filter(Boolean).length >= 2;
    const isLongPhrase = trimmedFinal.length >= 8;

    if (!(hasSentenceBoundary || (hasMultipleWords && isLongPhrase))) {
      return false;
    }

    return remainder.trim().length > 0;
  }
}
