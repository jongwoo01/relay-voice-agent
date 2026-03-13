import { describe, expect, it, vi } from "vitest";
import type { TaskRoutingTaskContext } from "@agent/shared-types";
import {
  GeminiTaskRoutingResolver,
  type TaskRoutingModelClientLike
} from "../src/index.js";

function createTaskContext(
  overrides: Partial<TaskRoutingTaskContext> = {}
): TaskRoutingTaskContext {
  return {
    task: {
      id: "task-1",
      title: "LLM 폴더 생성",
      normalizedGoal: "LLM 폴더 생성",
      status: "completed",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:05:00.000Z",
      completionReport: {
        summary: "LLM 폴더를 만들었어요.",
        verification: "verified",
        changes: ["LLM 폴더 생성"]
      }
    },
    isActive: false,
    isRecentCompleted: true,
    latestEventPreview: "Desktop/LLM 폴더 생성 완료",
    ...overrides
  };
}

describe("task-routing-resolver", () => {
  it("prompts the model to prefer create_task when the user references a completed task result for a new action", async () => {
    const generateContent = vi.fn(async ({ contents }) => {
      expect(contents).toContain("Prefer create_task when the user references the result of a recently completed task");
      expect(contents).toContain('Example: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘" -> create_task.');
      expect(contents).toContain("Recent completed tasks:");
      expect(contents).toContain('"isRecentCompleted":true');
      expect(contents).toContain('"latestEventPreview":"Desktop/LLM 폴더 생성 완료"');
      return {
        text: JSON.stringify({
          kind: "create_task",
          targetTaskId: null,
          clarificationNeeded: false,
          clarificationText: null,
          executorPrompt: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘",
          reason: "completed task result is being used as input for a new action"
        })
      };
    });
    const resolver = new GeminiTaskRoutingResolver({
      models: { generateContent }
    } satisfies TaskRoutingModelClientLike);

    const decision = await resolver.resolve({
      utterance: {
        text: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘",
        intent: "task_request",
        createdAt: "2026-03-08T00:06:00.000Z"
      },
      activeTasks: [],
      recentTasks: [createTaskContext().task],
      taskContexts: [createTaskContext()]
    });

    expect(decision).toEqual({
      kind: "create_task",
      targetTaskId: null,
      clarificationNeeded: false,
      clarificationText: null,
      executorPrompt: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘",
      reason: "completed task result is being used as input for a new action"
    });
  });

  it("keeps status and continue examples distinct in the prompt", async () => {
    const generateContent = vi.fn(async ({ contents }) => {
      expect(contents).toContain('Example: "아까 만든 폴더 작업 어디까지 됐어?" -> status.');
      expect(contents).toContain('Example: "그 작업 이어서 해" -> continue_task.');
      return {
        text: JSON.stringify({
          kind: "status",
          targetTaskId: "task-1",
          clarificationNeeded: false,
          clarificationText: null,
          executorPrompt: null,
          reason: "explicit result question"
        })
      };
    });
    const resolver = new GeminiTaskRoutingResolver({
      models: { generateContent }
    } satisfies TaskRoutingModelClientLike);

    const decision = await resolver.resolve({
      utterance: {
        text: "아까 만든 LLM 폴더 작업 결과 뭐였어?",
        intent: "task_request",
        createdAt: "2026-03-08T00:07:00.000Z"
      },
      activeTasks: [],
      recentTasks: [createTaskContext().task],
      taskContexts: [createTaskContext()]
    });

    expect(decision.kind).toBe("status");
    expect(decision.targetTaskId).toBe("task-1");
  });

  it("allows clarify when only a completed task exists and the user says '그거 이어서 해'", async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "clarify",
        targetTaskId: "task-1",
        clarificationNeeded: true,
        clarificationText: "어떤 작업을 이어야 하는지 한 번만 더 짚어줘.",
        executorPrompt: null,
        reason: "completed task exists but continue intent is ambiguous"
      })
    }));
    const resolver = new GeminiTaskRoutingResolver({
      models: { generateContent }
    } satisfies TaskRoutingModelClientLike);

    const decision = await resolver.resolve({
      utterance: {
        text: "그거 이어서 해",
        intent: "task_request",
        createdAt: "2026-03-08T00:08:00.000Z"
      },
      activeTasks: [],
      recentTasks: [createTaskContext().task],
      taskContexts: [createTaskContext()]
    });

    expect(decision).toEqual({
      kind: "clarify",
      targetTaskId: "task-1",
      clarificationNeeded: true,
      clarificationText: "어떤 작업을 이어야 하는지 한 번만 더 짚어줘.",
      executorPrompt: null,
      reason: "completed task exists but continue intent is ambiguous"
    });
  });
});
