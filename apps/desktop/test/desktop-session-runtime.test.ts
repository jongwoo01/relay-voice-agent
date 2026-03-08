import { describe, expect, it } from "vitest";
import { DesktopSessionRuntime } from "../src/main/session/desktop-session-runtime.js";

function createRuntime() {
  const runtime = new DesktopSessionRuntime({
    brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [],
        listRecentTasks: async () => [],
        getActiveTaskIntake: async () => null,
        listTaskEvents: async () => [],
        handleTurn: async () => undefined
      },
    intentResolver: {
      resolve: async () => "task_request"
    },
    onStateChange: undefined
  });

  runtime.execution = { mode: "mock" };
  return runtime;
}

function createDeferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve
  };
}

describe("desktop-session-runtime", () => {
  it("queues completed notifications while speaking and flushes them when idle", async () => {
    const runtime = createRuntime();
    await runtime.setAssistantSpeaking(true);

    runtime.handleAssistantNotification({
      message: {
        brainSessionId: "desktop-session-test",
        speaker: "assistant",
        text: "작업이 끝났어.",
        tone: "reply",
        createdAt: "2026-03-08T00:00:00.000Z"
      },
      priority: "normal",
      delivery: "next_turn",
      reason: "task_completed"
    });

    expect((await runtime.collectState()).notifications.pending).toHaveLength(1);

    await runtime.setAssistantSpeaking(false);

    const state = await runtime.collectState();
    expect(state.notifications.pending).toHaveLength(0);
    expect(state.notifications.delivered).toHaveLength(1);
    expect(state.notifications.delivered[0].delivery).toBe("next_turn");
  });

  it("delivers failure notifications immediately when idle", async () => {
    const runtime = createRuntime();

    runtime.handleAssistantNotification({
      message: {
        brainSessionId: "desktop-session-test",
        speaker: "assistant",
        text: "작업이 실패했어.",
        tone: "reply",
        createdAt: "2026-03-08T00:00:00.000Z"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "task_failed"
    });

    const state = await runtime.collectState();
    expect(state.notifications.delivered).toHaveLength(1);
    expect(state.notifications.pending).toHaveLength(0);
    expect(state.notifications.delivered[0].delivery).toBe("immediate");
  });

  it("sets in-flight state immediately and clears it after turn is processed", async () => {
    const deferred = createDeferred();
    const runtime = new DesktopSessionRuntime({
      brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [],
        listRecentTasks: async () => [],
        getActiveTaskIntake: async () => null,
        listTaskEvents: async () => [],
        handleTurn: async () => {
          await deferred.promise;
        }
      },
      intentResolver: {
        resolve: async () => "task_request"
      }
    });
    runtime.execution = { mode: "gemini" };

    const immediateState = await runtime.sendText("바탕화면 폴더 알려줘");
    expect(immediateState.input.inFlight).toBe(true);
    expect(immediateState.input.lastSubmittedText).toBe("바탕화면 폴더 알려줘");

    deferred.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const finalState = await runtime.collectState();
    expect(finalState.input.inFlight).toBe(false);
    expect(finalState.input.queueSize).toBe(0);
  });

  it("waits until queued turns and background work finish", async () => {
    const deferred = createDeferred();
    let handledTurns = 0;
    const runtime = new DesktopSessionRuntime({
      brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [],
        listRecentTasks: async () => [],
        getActiveTaskIntake: async () => null,
        listTaskEvents: async () => [],
        handleTurn: async () => {
          handledTurns += 1;
          await deferred.promise;
        },
        waitForBackgroundWork: async () => undefined
      },
      intentResolver: {
        resolve: async () => "task_request"
      }
    });
    runtime.execution = { mode: "mock" };

    await runtime.sendText("첫 번째 요청");
    await runtime.sendText("두 번째 요청");

    const waitPromise = runtime.waitForIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handledTurns).toBe(1);

    deferred.resolve();
    await waitPromise;

    expect(handledTurns).toBe(2);
    const finalState = await runtime.collectState();
    expect(finalState.input.inFlight).toBe(false);
    expect(finalState.input.queueSize).toBe(0);
  });

  it("routes typed and voice turns through the same canonical path", async () => {
    const handledTurns = [];
    const runtime = new DesktopSessionRuntime({
      brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [],
        listRecentTasks: async () => [],
        getActiveTaskIntake: async () => null,
        listTaskEvents: async () => [],
        handleTurn: async (turn) => {
          handledTurns.push(turn);
        },
        waitForBackgroundWork: async () => undefined
      },
      intentResolver: {
        resolve: async (text) =>
          text.includes("정리") ? "task_request" : "small_talk"
      }
    });
    runtime.execution = { mode: "mock" };

    await runtime.sendText("안녕");
    await runtime.handleVoiceTranscript("안녕");
    await runtime.waitForIdle();
    expect(handledTurns).toHaveLength(2);
    expect(handledTurns[0].utterance.text).toBe("안녕");
    expect(handledTurns[1].utterance.text).toBe("안녕");
    expect(handledTurns[0].utterance.intent).toBe("small_talk");
    expect(handledTurns[1].utterance.intent).toBe("small_talk");
  });

  it("publishes canonical turns and memory signals for typed input", async () => {
    const runtime = createRuntime();

    await runtime.submitCanonicalUserTurn({
      text: "오늘 운동했고 따뜻한 말투를 좋아해",
      source: "typed",
      createdAt: "2026-03-08T00:00:00.000Z"
    });
    await runtime.waitForIdle();

    const state = await runtime.collectState();
    expect(state.canonicalTurnStream.at(-1)).toEqual({
      text: "오늘 운동했고 따뜻한 말투를 좋아해",
      source: "typed",
      createdAt: "2026-03-08T00:00:00.000Z"
    });
    expect(state.memorySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "dated_life_log" }),
        expect.objectContaining({ type: "preferences" })
      ])
    );
  });

  it("derives main and sub avatar state from task and notification state", async () => {
    const runtime = new DesktopSessionRuntime({
      brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [
          {
            id: "task-1",
            title: "브라우저 정리",
            normalizedGoal: "브라우저 정리",
            status: "approval_required",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z"
          }
        ],
        listRecentTasks: async () => [
          {
            id: "task-1",
            title: "브라우저 정리",
            normalizedGoal: "브라우저 정리",
            status: "approval_required",
            brainSessionId: "desktop-session-test",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:01.000Z"
          }
        ],
        getActiveTaskIntake: async () => null,
        listTaskEvents: async () => [
          {
            taskId: "task-1",
            type: "executor_approval_required",
            message: "이 탭들을 닫아도 될지 확인해줘",
            createdAt: "2026-03-08T00:00:00.000Z"
          }
        ],
        handleTurn: async () => undefined
      },
      intentResolver: {
        resolve: async () => "task_request"
      }
    });
    runtime.execution = { mode: "mock" };

    runtime.handleAssistantNotification({
      message: {
        brainSessionId: "desktop-session-test",
        speaker: "assistant",
        text: "이건 실행 전에 확인이 필요해.",
        tone: "reply",
        createdAt: "2026-03-08T00:00:01.000Z"
      },
      priority: "high",
      delivery: "interrupt_if_speaking",
      reason: "approval_required"
    });

    const state = await runtime.collectState();
    expect(state.avatar.mainState).toBe("waiting_user");
    expect(state.avatar.subAvatars).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        status: "approval_required",
        blockingReason: "이 탭들을 닫아도 될지 확인해줘"
      })
    ]);
  });

  it("surfaces active task intake before a task is created", async () => {
    const runtime = new DesktopSessionRuntime({
      brainSessionId: "desktop-session-test",
      loop: {
        listConversation: async () => [],
        listActiveTasks: async () => [],
        listRecentTasks: async () => [],
        getActiveTaskIntake: async () => ({
          brainSessionId: "desktop-session-test",
          status: "collecting",
          sourceText: "메일 보내줘",
          workingText: "메일 보내줘",
          requiredSlots: ["target"],
          filledSlots: {},
          missingSlots: ["target"],
          lastQuestion: "누구에게 할지 알려줘.",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        }),
        listTaskEvents: async () => [],
        handleTurn: async () => undefined
      },
      intentResolver: {
        resolve: async () => "task_request"
      }
    });
    runtime.execution = { mode: "mock" };

    const state = await runtime.collectState();
    expect(state.avatar.mainState).toBe("waiting_user");
    expect(state.intake).toEqual(
      expect.objectContaining({
        active: true,
        missingSlots: ["target"],
        lastQuestion: "누구에게 할지 알려줘."
      })
    );
    expect(state.avatar.subAvatars).toEqual([]);
  });
});
