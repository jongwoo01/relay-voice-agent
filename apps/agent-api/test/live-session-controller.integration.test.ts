import { describe, expect, it } from "vitest";
import {
  LiveSessionController,
  LiveTranscriptAdapter
} from "../src/index.js";

describe("live-session-controller", () => {
  it("returns partial text without creating an assistant response", async () => {
    const controller = new LiveSessionController();

    const result = await controller.handleTranscriptChunk({
      brainSessionId: "brain-1",
      chunk: {
        text: "Browser tabs",
        createdAt: "2026-03-08T00:00:00.000Z",
        isFinal: false
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result).toEqual({
      partialText: "Browser tabs"
    });
  });

  it("returns a UI-ready assistant response for a final transcript", async () => {
    const controller = new LiveSessionController(
      new LiveTranscriptAdapter(undefined, {
        resolve: async () => ({
          intent: "small_talk",
          assistantReplyText: "Hello. Tell me what you need and I'll get started."
        })
      })
    );

    const result = await controller.handleTranscriptChunk({
      brainSessionId: "brain-1",
      chunk: {
        text: "hello",
        createdAt: "2026-03-08T00:00:00.000Z",
        isFinal: true
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.finalizedUtterance?.text).toBe("hello");
    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("Hello.");
  });
});
