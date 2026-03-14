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
      title: "LLM folder creation",
      normalizedGoal: "LLM folder creation",
      status: "completed",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:05:00.000Z",
      completionReport: {
        summary: "Created the LLM folder.",
        verification: "verified",
        changes: ["LLM folder creation"]
      }
    },
    isActive: false,
    isRecentCompleted: true,
    latestEventPreview: "Desktop/LLM folder creation Completed",
    ...overrides
  };
}

describe("task-routing-resolver", () => {
  it("prompts the model to prefer create_task when the user references a completed task result for a new action", async () => {
    const generateContent = vi.fn(async ({ contents }) => {
      expect(contents).toContain("Prefer create_task when the user references the result of a recently completed task");
      expect(contents).toContain('Example: "Create a txt file with today\'s LLM news in the LLM folder you created earlier" -> create_task.');
      expect(contents).toContain("Recent completed tasks:");
      expect(contents).toContain('"isRecentCompleted":true');
      expect(contents).toContain('"latestEventPreview":"Desktop/LLM folder creation Completed"');
      return {
        text: JSON.stringify({
          kind: "create_task",
          targetTaskId: null,
          clarificationNeeded: false,
          clarificationText: null,
          executorPrompt: "Create a txt file with current LLM news in the LLM folder you created earlier",
          reason: "completed task result is being used as input for a new action"
        })
      };
    });
    const resolver = new GeminiTaskRoutingResolver({
      models: { generateContent }
    } satisfies TaskRoutingModelClientLike);

    const decision = await resolver.resolve({
      utterance: {
        text: "Create a txt file with current LLM news in the LLM folder you created earlier",
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
      executorPrompt: "Create a txt file with current LLM news in the LLM folder you created earlier",
      reason: "completed task result is being used as input for a new action"
    });
  });

  it("keeps status and continue examples distinct in the prompt", async () => {
    const generateContent = vi.fn(async ({ contents }) => {
      expect(contents).toContain('Example: "How far along is that folder task?" -> status.');
      expect(contents).toContain('Example: "Tell me when it finishes" -> set_completion_notification.');
      expect(contents).toContain('Example: "Continue that task" -> continue_task.');
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
        text: "What was the result of the LLM folder task?",
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

  it("allows clarify when only a completed task exists and the user says 'Continue that'", async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "clarify",
        targetTaskId: "task-1",
        clarificationNeeded: true,
        clarificationText: "Which task should continue?",
        executorPrompt: null,
        reason: "completed task exists but continue intent is ambiguous"
      })
    }));
    const resolver = new GeminiTaskRoutingResolver({
      models: { generateContent }
    } satisfies TaskRoutingModelClientLike);

    const decision = await resolver.resolve({
      utterance: {
        text: "Continue that",
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
      clarificationText: "Which task should continue?",
      executorPrompt: null,
      reason: "completed task exists but continue intent is ambiguous"
    });
  });
});
