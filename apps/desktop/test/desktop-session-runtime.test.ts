import { describe, expect, it } from "vitest";
import { DesktopSessionRuntime } from "../src/main/session/desktop-session-runtime.js";

function createRuntime() {
  const runtime = new DesktopSessionRuntime({
    brainSessionId: "desktop-session-test",
    loop: {
      listConversation: async () => [],
      listActiveTasks: async () => [],
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
});
