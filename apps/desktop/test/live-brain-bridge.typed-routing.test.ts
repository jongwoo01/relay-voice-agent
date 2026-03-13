import { describe, expect, it, vi } from "vitest";
import { createLiveBrainBridge } from "../src/main/integration/live-brain-bridge.js";

function createIdleRuntimeState() {
  return {
    tasks: [],
    recentTasks: [],
    intake: { active: false, missingSlots: [] },
    notifications: { pending: [], delivered: [] },
    taskTimelines: []
  };
}

function createLiveSessionStub() {
  return {
    getState: vi.fn(async () => ({ session: "live" })),
    connect: vi.fn(async () => undefined),
    prefersToolRouting: vi.fn(() => true),
    sendText: vi.fn(async () => ({ session: "live" })),
    sendToolResponses: vi.fn(async () => ({ session: "live" })),
    syncRuntimeContext: vi.fn(async () => ({ session: "live" })),
    recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
    injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
    noteBridgeDecision: vi.fn(async () => ({ session: "live" })),
    noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" }))
  };
}

describe("live-brain-bridge typed routing", () => {
  it("sends ordinary typed chat directly to Live", async () => {
    const runtime = {
      collectState: vi.fn(async () => createIdleRuntimeState()),
      resolveIntent: vi.fn(async () => "small_talk"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: null,
        state: createIdleRuntimeState()
      }))
    };
    const liveVoiceSession = createLiveSessionStub();

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.sendTypedTurn("하이염");

    expect(runtime.resolveIntent).not.toHaveBeenCalled();
    expect(runtime.submitCanonicalUserTurnForDecision).not.toHaveBeenCalled();
    expect(liveVoiceSession.recordExternalUserTurn).not.toHaveBeenCalled();
    expect(liveVoiceSession.injectAssistantMessage).not.toHaveBeenCalled();
    expect(liveVoiceSession.sendText).toHaveBeenCalledWith("하이염");
    expect(result.liveState).toEqual({ session: "live" });
  });

  it("keeps typed follow-ups on the live path even when a task is active", async () => {
    const runningState = {
      tasks: [
        {
          id: "task-1",
          title: "브라우저 정리",
          status: "running"
        }
      ],
      recentTasks: [
        {
          id: "task-1",
          title: "브라우저 정리",
          status: "running"
        }
      ],
      intake: { active: false, missingSlots: [] },
      notifications: { pending: [], delivered: [] },
      taskTimelines: [
        {
          taskId: "task-1",
          events: [{ message: "탭 상태를 확인 중입니다." }]
        }
      ]
    };
    const runtime = {
      collectState: vi.fn(async () => runningState),
    };
    const liveVoiceSession = createLiveSessionStub();

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.sendTypedTurn("그거 다 됐어?");

    expect(liveVoiceSession.sendText).toHaveBeenCalledWith("그거 다 됐어?");
    expect(liveVoiceSession.injectAssistantMessage).not.toHaveBeenCalled();
    expect(result.sessionState.tasks[0].status).toBe("running");
  });

  it("keeps typed turns on the live path even when intake is actively waiting", async () => {
    const waitingIntakeState = {
      tasks: [],
      recentTasks: [
        {
          id: "task-2",
          title: "modern LLM 파일 작성",
          status: "clarifying"
        }
      ],
      intake: {
        active: true,
        sourceText:
          'search for "modern LLM technologies" and write the findings into a file named "modern LLM" in the "LLMtest" folder on the desktop',
        missingSlots: ["time", "risk_ack"]
      },
      notifications: { pending: [], delivered: [] },
      taskTimelines: [
        {
          taskId: "task-2",
          events: [{ message: "언제 할지랑 지워도 괜찮은 범위를 기다리는 중입니다." }]
        }
      ]
    };
    const runtime = {
      collectState: vi.fn(async () => waitingIntakeState)
    };
    const liveVoiceSession = createLiveSessionStub();

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.sendTypedTurn("right now and everything is fine");

    expect(liveVoiceSession.sendText).toHaveBeenCalledWith(
      "right now and everything is fine"
    );
    expect(liveVoiceSession.injectAssistantMessage).not.toHaveBeenCalled();
    expect(result.sessionState.intake.active).toBe(true);
    expect(result.sessionState.intake.missingSlots).toEqual(["time", "risk_ack"]);
  });
});
