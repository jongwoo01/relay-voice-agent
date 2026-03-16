import { describe, expect, it } from "vitest";
import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  type TaskIntakeResolver,
  type TaskRoutingDecision,
  type TaskRoutingResolver,
  type TaskRoutingResolverInput,
  TextRealtimeSessionLoop
} from "../src/index.js";

function utterance(
  text: string,
  intent: FinalizedUtterance["intent"]
): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

class QueueDeferredExecutor implements LocalExecutor {
  public readonly calls: ExecutorRunRequest[] = [];
  private readonly resolvers: Array<() => void> = [];

  async run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    this.calls.push(request);
    const progressEvent = {
      taskId: request.task.id,
      type: "executor_progress" as const,
      message: "Task is running",
      createdAt: request.now
    };
    if (onProgress) {
      await onProgress(progressEvent);
    }

    return await new Promise<ExecutorRunResult>((resolve) => {
      this.resolvers.push(() =>
        resolve({
          progressEvents: [progressEvent],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_completed",
            message: "Completed",
            createdAt: request.now
          },
          sessionId: request.resumeSessionId ?? "session-created"
        })
      );
    });
  }

  resolveAll() {
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.();
    }
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

class ScriptedTaskRoutingResolver implements TaskRoutingResolver {
  async resolve(input: TaskRoutingResolverInput): Promise<TaskRoutingDecision> {
    if (input.utterance.text === "Check the folder on the desktop") {
      return {
        kind: "create_task",
        targetTaskId: null,
        clarificationNeeded: false,
        clarificationText: null,
        executorPrompt: "Check the folder on the desktop",
        reason: "new task"
      };
    }

    const activeTaskId = input.activeTasks[0]?.id ?? null;
    if (!activeTaskId) {
      throw new Error("Expected an active task for follow-up routing");
    }

    if (input.utterance.text === "Continue it") {
      return {
        kind: "continue_task",
        targetTaskId: activeTaskId,
        clarificationNeeded: false,
        clarificationText: null,
        executorPrompt: "Continue it",
        reason: "explicit continuation"
      };
    }

    if (input.utterance.text === "Tell me when it finishes") {
      return {
        kind: "set_completion_notification",
        targetTaskId: activeTaskId,
        clarificationNeeded: false,
        clarificationText: null,
        executorPrompt: null,
        reason: "completion notification request"
      };
    }

    throw new Error(`Unexpected utterance for test: ${input.utterance.text}`);
  }
}

const scriptedTaskIntakeResolver: TaskIntakeResolver = {
  analyzeStart: async (text) => {
    if (text === "Check the folder on the desktop") {
      return { requiredSlots: [], filledSlots: {} };
    }

    return { requiredSlots: [], filledSlots: {} };
  },
  analyzeUpdate: async () => ({
    resolution: "answer_current_intake",
    requiredSlots: [],
    filledSlots: {}
  })
};

describe("text-realtime-session-loop follow-up behavior", () => {
  it("does not auto-resume ambiguous short follow-ups and only continues when routing says so", async () => {
    const executor = new QueueDeferredExecutor();
    const loop = new TextRealtimeSessionLoop(executor, undefined, undefined, {
      taskIntakeResolver: scriptedTaskIntakeResolver,
      taskRoutingResolver: new ScriptedTaskRoutingResolver()
    });

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("Check the folder on the desktop", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("task_ack");
    expect(firstTurn.task?.status).toBe("running");
    expect(executor.calls).toHaveLength(1);

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("please", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("reply");
    expect(secondTurn.task).toBeUndefined();
    expect(executor.calls).toHaveLength(1);

    const thirdTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("Continue it", "task_request"),
      now: "2026-03-08T00:00:02.000Z"
    });

    expect(thirdTurn.assistant.tone).toBe("task_ack");
    expect(thirdTurn.task?.id).toBe(firstTurn.task?.id);
    expect(executor.calls).toHaveLength(2);

    const fourthTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("Tell me when it finishes", "task_request"),
      now: "2026-03-08T00:00:03.000Z"
    });

    expect(fourthTurn.assistant.tone).toBe("reply");
    expect(fourthTurn.assistant.text).toContain(
      "I'll let you know as soon as the current task finishes."
    );
    expect(fourthTurn.task?.id).toBe(firstTurn.task?.id);
    expect(executor.calls).toHaveLength(2);

    executor.resolveAll();
    await loop.waitForBackgroundWork();
  });
});
