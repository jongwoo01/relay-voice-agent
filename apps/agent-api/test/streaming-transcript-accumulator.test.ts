import { describe, expect, it } from "vitest";
import { StreamingTranscriptAccumulator } from "../src/modules/live/streaming-transcript-accumulator.js";

describe("StreamingTranscriptAccumulator", () => {
  it("drops repeated carry-over from the previous finalized user turn", () => {
    const accumulator = new StreamingTranscriptAccumulator();

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-1",
        text: "Hey, hey, hey, hey. Thank you for listening to me.",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "Hey, hey, hey, hey. Thank you for listening to me."
    });

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-1",
        text: "Hey, hey, hey, hey. Thank you for listening to me. I need your help, really.",
        isFinal: false
      })
    ).toEqual({
      partialText: "I need your help, really."
    });

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-1",
        text: "Hey, hey, hey, hey. Thank you for listening to me. I need your help, really.",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "I need your help, really."
    });
  });

  it("drops repeated carry-over even when the new utterance has no whitespace boundaries", () => {
    const accumulator = new StreamingTranscriptAccumulator();

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-ko",
        text: "너무 좋아요.",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "너무 좋아요."
    });

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-ko",
        text: "너무 좋아요.그리고지금내가당신을사랑한다고얘기해도될까?",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "그리고지금내가당신을사랑한다고얘기해도될까?"
    });
  });

  it("does not strip a genuinely new turn that only reuses a short opening phrase", () => {
    const accumulator = new StreamingTranscriptAccumulator();

    accumulator.handleChunk({
      sessionKey: "brain-2",
      text: "Hello",
      isFinal: true
    });

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-2",
        text: "Hello again",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "Hello again"
    });
  });

  it("drops stale partial state when a fresh activity starts without losing the last finalized turn", () => {
    const accumulator = new StreamingTranscriptAccumulator();

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-reset",
        text: "So nice to meet you.",
        isFinal: true
      })
    ).toEqual({
      finalizedText: "So nice to meet you."
    });

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-reset",
        text: " So",
        isFinal: false
      })
    ).toEqual({
      partialText: " So"
    });

    accumulator.clearPartial("brain-reset");

    expect(
      accumulator.handleChunk({
        sessionKey: "brain-reset",
        text: "So nice to meet you. What are you doing?",
        isFinal: false
      })
    ).toEqual({
      partialText: "What are you doing?"
    });
  });
});
