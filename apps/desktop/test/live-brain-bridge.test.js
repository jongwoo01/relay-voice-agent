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

describe("live-brain-bridge", () => {
  it("routes voice task transcripts through runtime-first", async () => {
    const runtime = {
      collectState: vi.fn(async () => createIdleRuntimeState()),
      resolveIntent: vi.fn(async () => "task_request"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: createIdleRuntimeState()
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();

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
      collectState: vi.fn(async () => createIdleRuntimeState()),
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
        state: createIdleRuntimeState()
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();

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
      collectState: vi.fn(async () => createIdleRuntimeState()),
      resolveIntent: vi.fn(async () => "question"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: createIdleRuntimeState()
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();

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
      collectState: vi.fn(async () => createIdleRuntimeState()),
      resolveIntent: vi.fn(async () => "question"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "좋아, 바로 확인해볼게.",
            tone: "task_ack"
          }
        },
        state: createIdleRuntimeState()
      })),
      submitCanonicalUserTurn: vi.fn(async () => ({ session: "runtime" }))
    };
    const liveVoiceSession = createLiveSessionStub();

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

  it("routes typed follow-ups through runtime-first without sending live text", async () => {
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
      resolveIntent: vi.fn(async () => "question"),
      submitCanonicalUserTurnForDecision: vi.fn(async () => ({
        handled: {
          assistant: {
            text: "아직 확인 중이야. 끝나면 바로 브리핑할게.",
            tone: "reply"
          }
        },
        state: runningState
      }))
    };
    const liveVoiceSession = createLiveSessionStub();

    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });
    const result = await bridge.sendTypedTurn("그거 다 됐어?");

    expect(runtime.submitCanonicalUserTurnForDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "그거 다 됐어?",
        source: "typed",
        intent: "question"
      })
    );
    expect(liveVoiceSession.sendText).not.toHaveBeenCalled();
    expect(liveVoiceSession.injectAssistantMessage).toHaveBeenCalledWith(
      "아직 확인 중이야. 끝나면 바로 브리핑할게.",
      "reply"
    );
    expect(result.sessionState.tasks[0].status).toBe("running");
  });

  it("sends ordinary typed chat directly to Live instead of runtime-first", async () => {
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
          message: "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요."
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
          text: "바탕화면에 있는 3개의 폴더(26HONGIK, projects, WorkSpace)를 확인했어요.",
          tone: "reply"
        }
      })
    );
  });

  it("routes single live tool calls through the runtime delegate backend", async () => {
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
      handleDelegateToGeminiCli: vi.fn(async () => ({
        result: {
          action: "status",
          accepted: true,
          taskId: "task-1",
          status: "running",
          message: "탭 상태를 확인 중입니다."
        },
        state: runningState
      }))
    };
    const liveVoiceSession = createLiveSessionStub();
    const bridge = createLiveBrainBridge({ runtime, liveVoiceSession });

    const responses = await bridge.handleToolCalls([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        args: {
          request: "그거 어디까지 했어?",
          taskId: "task-1",
          mode: "status"
        }
      }
    ]);

    expect(runtime.handleDelegateToGeminiCli).toHaveBeenCalledWith({
      request: "그거 어디까지 했어?",
      taskId: "task-1",
      mode: "status",
      now: expect.any(String)
    });
    expect(liveVoiceSession.syncRuntimeContext).toHaveBeenCalled();
    expect(responses).toEqual([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        response: {
          output: {
            action: "status",
            accepted: true,
            taskId: "task-1",
            status: "running",
            message: "탭 상태를 확인 중입니다."
          }
        },
        willContinue: true
      }
    ]);
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

    await bridge.handleToolCalls([
      {
        id: "call-1",
        name: "delegate_to_gemini_cli",
        args: {
          request: "바탕화면에 있는 파일이랑 폴더 전부 알려줘"
        }
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
});
