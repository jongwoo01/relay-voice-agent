import { describe, expect, it, vi } from "vitest";
import { createLiveBrainBridge } from "../src/main/integration/live-brain-bridge.js";

describe("live-brain-bridge", () => {
  it("routes voice task transcripts through runtime-first", async () => {
    const runtime = {
      collectState: vi.fn(async () => ({ ok: true })),
      resolveIntent: vi.fn(async () => "task_request"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: { session: "runtime" }
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = {
      getState: vi.fn(async () => ({ session: "live" })),
      connect: vi.fn(async () => undefined),
      sendText: vi.fn(async () => ({ session: "live" })),
      recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
      injectAssistantMessage: vi.fn(async () => ({ session: "live" }))
    };

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.handleFinalTranscript(
      "내 바탕화면에 뭐가 있니?"
    );

    expect(runtime.resolveIntent).toHaveBeenCalledWith(
      "내 바탕화면에 뭐가 있니?"
    );
    expect(runtime.submitCanonicalUserTurnForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "내 바탕화면에 뭐가 있니?",
        source: "voice",
        intent: "task_request"
      })
    );
    expect(runtime.submitCanonicalUserTurn).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        mode: "runtime-first",
        assistant: {
          text: "좋아, 바로 확인해볼게.",
          tone: "task_ack"
        }
      })
    );
  });

  it("uses a stronger partial-transcript hint when the final transcript is too weak", async () => {
    const runtime = {
      collectState: vi.fn(async () => ({ ok: true })),
      resolveIntent: vi
        .fn()
        .mockResolvedValueOnce("small_talk")
        .mockResolvedValueOnce("task_request"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: { session: "runtime" }
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = {
      getState: vi.fn(async () => ({ session: "live" })),
      connect: vi.fn(async () => undefined),
      sendText: vi.fn(async () => ({ session: "live" })),
      recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
      injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
      noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" }))
    };

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.handleFinalTranscript("리 좀 알려 줘", {
      routingHints: ["내 바탕화면에 무슨 폴더나 파일이 있는지 알려 줘"]
    });

    expect(runtime.resolveIntent).toHaveBeenNthCalledWith(1, "리 좀 알려 줘");
    expect(runtime.resolveIntent).toHaveBeenNthCalledWith(
      2,
      "내 바탕화면에 무슨 폴더나 파일이 있는지 알려 줘"
    );
    expect(runtime.submitCanonicalUserTurnForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "내 바탕화면에 무슨 폴더나 파일이 있는지 알려 줘",
        source: "voice",
        intent: "task_request"
      })
    );
    expect(result.mode).toBe("runtime-first");
  });

  it("forces runtime-first for local-state voice questions even when intent resolves as question", async () => {
    const runtime = {
      collectState: vi.fn(async () => ({ ok: true })),
      resolveIntent: vi.fn(async () => "question"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: { session: "runtime" }
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = {
      getState: vi.fn(async () => ({ session: "live" })),
      connect: vi.fn(async () => undefined),
      sendText: vi.fn(async () => ({ session: "live" })),
      recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
      injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
      noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" }))
    };

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.handleFinalTranscript(
      "내 바탕화면에 무슨 폴더나 파일이 있는지 보이니?"
    );

    expect(runtime.resolveIntent).not.toHaveBeenCalled();
    expect(runtime.submitCanonicalUserTurnForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "내 바탕화면에 무슨 폴더나 파일이 있는지 보이니?",
        source: "voice",
        intent: "task_request"
      })
    );
    expect(result.mode).toBe("runtime-first");
  });

  it("forces runtime-first for clipped korean partial transcripts that still contain local-state cues", async () => {
    const runtime = {
      collectState: vi.fn(async () => ({ ok: true })),
      resolveIntent: vi.fn(async () => "question"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: { session: "runtime" }
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = {
      getState: vi.fn(async () => ({ session: "live" })),
      connect: vi.fn(async () => undefined),
      sendText: vi.fn(async () => ({ session: "live" })),
      recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
      injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
      noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" })),
      noteBridgeDecision: vi.fn(async () => ({ session: "live" }))
    };

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.handleFinalTranscript(
      "탕화면에서파일이랑폴더개수,종류이름알려줘.",
      {
        routingHints: ["탕화면에서파일이랑폴더개수,종류이름알려줘."],
        inferredFromPartial: true
      }
    );

    expect(runtime.resolveIntent).not.toHaveBeenCalled();
    expect(runtime.submitCanonicalUserTurnForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "탕화면에서파일이랑폴더개수,종류이름알려줘.",
        source: "voice",
        intent: "task_request"
      })
    );
    expect(result.mode).toBe("runtime-first");
  });
});
