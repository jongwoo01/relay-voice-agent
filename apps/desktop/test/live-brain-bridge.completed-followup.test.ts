import { describe, expect, it, vi } from "vitest";
import { createLiveBrainBridge } from "../src/main/integration/live-brain-bridge.js";

function createLiveSessionStub() {
  return {
    getState: vi.fn(async () => ({ session: "live" })),
    connect: vi.fn(async () => undefined),
    sendText: vi.fn(async () => ({ session: "live" })),
    syncRuntimeContext: vi.fn(async () => ({ session: "live" })),
    recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
    injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
    noteBridgeDecision: vi.fn(async () => ({ session: "live" })),
    noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" }))
  };
}

describe("live-brain-bridge completed follow-up", () => {
  it("routes completed-task voice follow-ups through the delegate backend", async () => {
    const completedState = {
      tasks: [],
      recentTasks: [
        {
          id: "task-1",
          title: "바탕화면 확인",
          status: "completed"
        }
      ],
      intake: { active: false, missingSlots: [] },
      notifications: {
        pending: [],
        delivered: [
          {
            reason: "task_completed",
            uiText: "바탕화면에 있는 3개의 폴더를 확인했어요."
          }
        ]
      },
      taskTimelines: [
        {
          taskId: "task-1",
          events: [{ message: "바탕화면에 있는 3개의 폴더를 확인했어요." }]
        }
      ]
    };
    const runtime = {
      collectState: vi.fn(async () => completedState),
      resolveIntent: vi.fn(async () => "task_request"),
      handleDelegateToGeminiCli: vi.fn(async () => ({
        result: {
          action: "status",
          accepted: true,
          taskId: "task-1",
          status: "completed",
          message:
            "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요."
        },
        state: completedState
      })),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: null,
        state: completedState
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();
    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });

    const result = await bridge.handleFinalTranscript("그거 뭐였는지 다시 말해줘");

    expect(runtime.handleDelegateToGeminiCli).toHaveBeenCalledWith({
      request: "그거 뭐였는지 다시 말해줘",
      mode: "auto",
      now: expect.any(String)
    });
    expect(runtime.submitCanonicalUserTurnForDecision).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        mode: "runtime-first",
        assistant: {
          text:
            "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
          tone: "reply"
        }
      })
    );
  });
});
