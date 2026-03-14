import { describe, expect, it } from "vitest";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  BrainTurnService,
  FinalizedUtteranceHandler,
  type IntentResolution,
  LiveTranscriptAdapter,
  RealtimeGatewayService,
  type IntentResolver,
  type TaskRoutingResolver
} from "../src/index.js";

const taskRoutingResolver: TaskRoutingResolver = {
  resolve: async (input) => ({
    kind: input.utterance.intent === "task_request" ? "create_task" : "reply",
    targetTaskId: null,
    clarificationNeeded: false,
    clarificationText: null,
    executorPrompt:
      input.utterance.intent === "task_request" ? input.utterance.text : null,
    reason: "test routing decision"
  })
};

const intentResolver: IntentResolver = {
  resolve: async (text) =>
    text.toLowerCase() === "hello"
      ? ({
          intent: "small_talk",
          assistantReplyText: "Hello. Tell me what you need and I'll get started."
        } satisfies IntentResolution)
      : ({
          intent: "task_request"
        } satisfies IntentResolution)
};

function createAdapter(): LiveTranscriptAdapter {
  return new LiveTranscriptAdapter(
    new RealtimeGatewayService(
      new FinalizedUtteranceHandler(
        new BrainTurnService(
          undefined,
          undefined,
          taskRoutingResolver
        )
      )
    ),
    intentResolver
  );
}

describe("live-transcript-adapter", () => {
  it("stores partial transcript without triggering the brain flow", async () => {
    const adapter = createAdapter();

    const result = await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "browser tabs",
      createdAt: "2026-03-08T00:00:00.000Z",
      now: "2026-03-08T00:00:00.000Z",
      isFinal: false
    });

    expect(result).toEqual({
      isFinal: false,
      partialText: "browser tabs"
    });
    expect(adapter.getPartialText("brain-1")).toBe("browser tabs");
  });

  it("turns a final transcript into a UI-ready assistant envelope", async () => {
    const adapter = createAdapter();

    const result = await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "hello",
      createdAt: "2026-03-08T00:00:00.000Z",
      now: "2026-03-08T00:00:00.000Z",
      isFinal: true
    });

    expect(result.finalizedUtterance).toEqual<FinalizedUtterance>({
      text: "hello",
      intent: "small_talk",
      assistantReplyText: "Hello. Tell me what you need and I'll get started.",
      createdAt: "2026-03-08T00:00:00.000Z"
    });
    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("Hello.");
    expect(adapter.getPartialText("brain-1")).toBeUndefined();
  });

  it("uses the stored partial transcript when the final chunk is empty", async () => {
    const adapter = createAdapter();

    await adapter.handleTranscript({
      brainSessionId: "brain-1",
      text: "Organize the desktop files by type",
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

    expect(result.finalizedUtterance?.text).toBe("Organize the desktop files by type");
    expect(result.assistant?.tone).toBe("task_ack");
    expect(result.task?.status).toBe("running");
  });
});
