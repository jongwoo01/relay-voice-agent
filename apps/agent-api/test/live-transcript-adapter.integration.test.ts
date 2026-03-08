import { describe, expect, it } from "vitest";
import type { FinalizedUtterance } from "@agent/shared-types";
import { HeuristicIntentResolver, LiveTranscriptAdapter } from "../src/index.js";

describe("live-transcript-adapter", () => {
  it("stores partial transcript without triggering the brain flow", async () => {
    const adapter = new LiveTranscriptAdapter(undefined, new HeuristicIntentResolver());

    const result = await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "브라우저 탭",
      createdAt: "2026-03-08T00:00:00.000Z",
      now: "2026-03-08T00:00:00.000Z",
      isFinal: false
    });

    expect(result).toEqual({
      isFinal: false,
      partialText: "브라우저 탭"
    });
    expect(adapter.getPartialText("brain-1")).toBe("브라우저 탭");
  });

  it("turns a final transcript into a UI-ready assistant envelope", async () => {
    const adapter = new LiveTranscriptAdapter(undefined, new HeuristicIntentResolver());

    const result = await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "안녕",
      createdAt: "2026-03-08T00:00:00.000Z",
      now: "2026-03-08T00:00:00.000Z",
      isFinal: true
    });

    expect(result.finalizedUtterance).toEqual<FinalizedUtterance>({
      text: "안녕",
      intent: "small_talk",
      createdAt: "2026-03-08T00:00:00.000Z"
    });
    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("안녕하세요");
    expect(adapter.getPartialText("brain-1")).toBeUndefined();
  });

  it("uses the stored partial transcript when the final chunk is empty", async () => {
    const adapter = new LiveTranscriptAdapter(undefined, new HeuristicIntentResolver());

    await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "브라우저 탭 정리해줘",
      createdAt: "2026-03-08T00:00:00.000Z",
      now: "2026-03-08T00:00:00.000Z",
      isFinal: false
    });

    const result = await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "",
      createdAt: "2026-03-08T00:00:01.000Z",
      now: "2026-03-08T00:00:01.000Z",
      isFinal: true
    });

    expect(result.finalizedUtterance?.text).toBe("브라우저 탭 정리해줘");
    expect(result.assistant?.tone).toBe("task_ack");
    expect(result.task?.status).toBe("running");
  });
});
