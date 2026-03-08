import { describe, expect, it } from "vitest";
import { LiveSessionController } from "../src/index.js";

describe("live-session-controller", () => {
  it("returns partial text without creating an assistant response", async () => {
    const controller = new LiveSessionController();

    const result = await controller.handleTranscriptChunk({
      brainSessionId: "brain-1",
      chunk: {
        text: "브라우저 탭",
        createdAt: "2026-03-08T00:00:00.000Z",
        isFinal: false
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result).toEqual({
      partialText: "브라우저 탭"
    });
  });

  it("returns a UI-ready assistant response for a final transcript", async () => {
    const controller = new LiveSessionController();

    const result = await controller.handleTranscriptChunk({
      brainSessionId: "brain-1",
      chunk: {
        text: "안녕",
        createdAt: "2026-03-08T00:00:00.000Z",
        isFinal: true
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.finalizedUtterance?.text).toBe("안녕");
    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("안녕하세요");
  });
});
