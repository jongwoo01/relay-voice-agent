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
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

const activeTask: Task = {
  id: "task-existing",
  title: "브라우저 정리",
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
      utterance: utterance("안녕", "small_talk"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("안녕하세요");
  });

  it("returns a task acknowledgement envelope and task metadata for a fresh task", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        undefined,
        {
          resolve: async () => createRoutingDecision()
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("바탕화면 파일들을 종류별로 정리해줘", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant).toEqual({
      text: "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
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
        undefined,
        {
          resolve: async () =>
            createRoutingDecision({
              kind: "clarify",
              clarificationNeeded: true,
              clarificationText: "언제 할지 한 번만 더 알려줘."
            })
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("일정 잡아줘", "task_request"),
      activeTasks: [],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant.tone).toBe("clarify");
    expect(result.assistant.text).toContain("언제 할지");
    expect(result.task).toBeUndefined();
  });

  it("returns a resume acknowledgement when the utterance maps to an active task", async () => {
    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        undefined,
        undefined,
        undefined,
        {
          resolve: async () =>
            createRoutingDecision({
              kind: "continue_task",
              targetTaskId: "task-existing",
              executorPrompt: "아까 하던 거 이어서 해"
            })
        } satisfies TaskRoutingResolver
      )
    );

    const result = await handler.handle({
      brainSessionId: "brain-1",
      utterance: utterance("아까 하던 거 이어서 해", "task_request"),
      activeTasks: [activeTask],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.assistant).toEqual({
      text: "이어서 진행할게. 작업 상태는 패널에 보여줄게.",
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
      utterance: utterance("그 작업 상태 알려줘", "task_request"),
      activeTasks: [activeTask],
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.action).toEqual({
      type: "status",
      taskId: "task-existing"
    });
    expect(result.assistant).toEqual({
      text: "작업을 계속 확인하고 있어요.",
      tone: "reply"
    });
    expect(result.task).toEqual(activeTask);
  });
});
