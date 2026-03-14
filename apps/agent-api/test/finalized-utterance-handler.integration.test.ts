import { describe, expect, it } from "vitest";
import type { FinalizedUtterance, Task } from "@agent/shared-types";
import {
  BrainTurnService,
  FinalizedUtteranceHandler,
  type TaskRoutingDecision,
  type TaskRoutingResolver
} from "../src/index.js";

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    ...(intent === "small_talk"
      ? { assistantReplyText: "Hello. Tell me what you need and I'll get started." }
      : {}),
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

const activeTask: Task = {
  id: "task-existing",
  title: "Browser cleanup",
  normalizedGoal: "browser cleanup",
  status: "running",
  createdAt: "2026-03-08T00:00:00.000Z",
  updatedAt: "2026-03-08T00:00:00.000Z"
};

function createRoutingDecision(
  overrides: Partial<TaskRoutingDecision> = {}
): TaskRoutingDecision {
  return {
    kind: "create_task",
    targetTaskId: null,
    clarificationNeeded: false,
    clarificationText: null,
    executorPrompt: null,
    reason: "test routing decision",
    ...overrides
  };
}

describe("finalized-utterance-handler", () => {
  it("returns a normal assistant reply envelope for small talk", async () => {
    const handler = new FinalizedUtteranceHandler();

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("hello", "small_talk"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("Hello.");
  });

  it("returns a task acknowledgement envelope and task metadata for a fresh task", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        {
          resolve: async () => createRoutingDecision()
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Organize the desktop files by type", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant).toEqual({
      text: "I'll start the task now. Progress will stay visible in the panel.",
      tone: "task_ack"
    });
    expect(result.task?.status).toBe("running");
    expect(result.taskEvents?.map((event) => event.type)).toEqual([
      "task_created",
      "task_queued",
      "task_started"
    ]);
  });

  it("returns a clarify-style envelope for task intake follow-ups", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        {
          resolve: async () =>
            createRoutingDecision({
              kind: "clarify",
              clarificationNeeded: true,
              clarificationText: "Tell me when it should happen one more time."
            })
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Schedule it", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant.tone).toBe("clarify");
    expect(result.assistant.text).toContain("when it should happen");
    expect(result.task).toBeUndefined();
  });

  it("returns a resume acknowledgement when the utterance maps to an active task", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        {
          resolve: async () =>
            createRoutingDecision({
              kind: "continue_task",
              targetTaskId: "task-existing",
              executorPrompt: "Continue that task"
            })
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Continue that task", "task_request"),
      activeTasks: [activeTask],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant).toEqual({
      text: "I'll continue from there. The task state will stay visible in the panel.",
      tone: "task_ack"
    });
    expect(result.task?.id).toBe("task-existing");
    expect(result.taskEvents?.map((event) => event.type)).toEqual(["task_started"]);
  });

  it("preserves task metadata when the turn resolves to a status action", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        {
          resolve: async () =>
            createRoutingDecision({
              kind: "status",
              targetTaskId: "task-existing"
            })
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("Tell me the status of that task", "task_request"),
      activeTasks: [activeTask],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({
      type: "status",
      taskId: "task-existing"
    });
    expect(result.assistant).toEqual({
      text: "The task is still running.",
      tone: "reply"
    });
    expect(result.task).toEqual(activeTask);
  });
});
