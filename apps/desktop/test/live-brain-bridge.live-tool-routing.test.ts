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
    prefersToolRouting: vi.fn(() => false),
    sendText: vi.fn(async () => ({ session: "live" })),
    sendToolResponses: vi.fn(async () => ({ session: "live" })),
    syncRuntimeContext: vi.fn(async () => ({ session: "live" })),
    recordExternalUserTurn: vi.fn(async () => ({ session: "live" })),
    injectAssistantMessage: vi.fn(async () => ({ session: "live" })),
    noteBridgeDecision: vi.fn(async () => ({ session: "live" })),
    noteRuntimeFirstDelegation: vi.fn(async () => ({ session: "live" }))
  };
}

describe("live-brain-bridge live tool routing", () => {
  it("lets Live own voice local-task turns when tool routing is enabled", async () => {
    const runtime = {
      collectState: vi.fn(async () => createIdleRuntimeState()),
      resolveIntent: vi.fn(async () => "task_request"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: null,
        state: createIdleRuntimeState()
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();
    liveVoiceSession.prefersToolRouting.mockReturnValue(true);

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.handleFinalTranscript(
      "바탕화면에 있는 파일이랑 폴더 전부 알려줘"
    );

    expect(runtime.submitCanonicalUserTurnForDecision).not.toHaveBeenCalled();
    expect(runtime.submitCanonicalUserTurn).not.toHaveBeenCalled();
    expect(result.mode).toBe("live-runtime");
  });

  it("sends a follow-up tool response when a tracked task completes", async () => {
    const runningState = {
      tasks: [
        {
          id: "task-1",
          title: "바탕화면 확인",
          status: "running"
        }
      ],
      recentTasks: [
        {
          id: "task-1",
          title: "바탕화면 확인",
          status: "running"
        }
      ],
      intake: { active: false, missingSlots: [] },
      notifications: { pending: [], delivered: [] },
      taskTimelines: []
    };
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
            uiText:
              "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요."
          }
        ]
      },
      taskTimelines: []
    };
    const runtime = {
      collectState: vi.fn(async () => runningState),
      handleDelegateToGeminiCli: vi
        .fn()
        .mockResolvedValueOnce({
          result: {
            action: "created",
            accepted: true,
            taskId: "task-1",
            status: "running",
            message: "작업을 시작할게. 진행 상황은 패널에 보여줄게."
          },
          state: runningState
        })
        .mockResolvedValueOnce({
          result: {
            action: "status",
            accepted: true,
            taskId: "task-1",
            status: "completed",
            message:
              "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
            summary:
              "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
            verification: "verified",
            changes: []
          },
          state: completedState
        })
    };
    const liveVoiceSession = createLiveSessionStub();
    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });

    const responses = await bridge.handleToolCalls([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        args: {
          request: "바탕화면에 있는 파일이랑 폴더 전부 알려줘"
        }
      }
    ]);

    expect(responses).toEqual([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            action: "created",
            accepted: true,
            taskId: "task-1",
            status: "running",
            message: "작업을 시작할게. 진행 상황은 패널에 보여줄게."
          }
        },
        willContinue: true
      }
    ]);

    await bridge.syncRuntimeContextFromState(completedState);

    expect(runtime.handleDelegateToGeminiCli).toHaveBeenNthCalledWith(2, {
      request: "상태 알려줘",
      taskId: "task-1",
      mode: "status",
      now: expect.any(String)
    });
    expect(liveVoiceSession.sendToolResponses).toHaveBeenCalledWith([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            action: "status",
            accepted: true,
            taskId: "task-1",
            status: "completed",
            message:
              "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
            summary:
              "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
            verification: "verified",
            changes: []
          }
        },
        scheduling: "WHEN_IDLE",
        willContinue: false
      }
    ]);
  });

  it("silences duplicate running continuation polls for the same task", async () => {
    const runningState = {
      tasks: [
        {
          id: "task-1",
          title: "바탕화면 확인",
          normalizedGoal: "바탕화면 확인",
          status: "running"
        }
      ],
      recentTasks: [
        {
          id: "task-1",
          title: "바탕화면 확인",
          normalizedGoal: "바탕화면 확인",
          status: "running"
        }
      ],
      intake: { active: false, missingSlots: [] },
      notifications: { pending: [], delivered: [] },
      taskTimelines: []
    };
    const runtime = {
      handleDelegateToGeminiCli: vi.fn(async () => ({
        result: {
          action: "status",
          accepted: true,
          taskId: "task-1",
          status: "running",
          message: "작업을 계속 확인하고 있어요."
        },
        state: runningState
      }))
    };
    const liveVoiceSession = createLiveSessionStub();
    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });

    const first = await bridge.handleToolCalls([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        args: { request: "바탕화면 확인해줘" }
      }
    ]);
    const second = await bridge.handleToolCalls([
      {
        id: "call-2",
        name: "delegate_to_gemini_cli",
        args: { request: "바탕화면 확인해줘" }
      }
    ]);

    expect(first).toEqual([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            action: "status",
            accepted: true,
            taskId: "task-1",
            status: "running",
            message: "작업을 계속 확인하고 있어요."
          }
        },
        willContinue: true
      }
    ]);
    expect(second).toEqual([
      {
        id: "call-2",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            action: "status",
            accepted: true,
            taskId: "task-1",
            status: "running",
            message: "작업을 계속 확인하고 있어요."
          }
        },
        scheduling: "SILENT",
        willContinue: true
      }
    ]);
  });
});
