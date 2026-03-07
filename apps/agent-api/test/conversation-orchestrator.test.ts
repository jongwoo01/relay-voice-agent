import { describe, expect, it } from "vitest";
import { ConversationOrchestrator } from "../src/index.js";
import type { FinalizedUtterance, Task } from "@agent/shared-types";

const orchestrator = new ConversationOrchestrator();

const activeTask: Task = {
  id: "task-1",
  title: "Browser cleanup",
  normalizedGoal: "browser cleanup",
  status: "running",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z"
};

const utterance: FinalizedUtterance = {
  text: "아까 하던 거 이어서 해",
  intent: "task_request",
  createdAt: "2026-03-07T00:00:00.000Z"
};

describe("conversation-orchestrator", () => {
  it("delegates to the brain-domain decision logic", () => {
    expect(orchestrator.decide(utterance, [activeTask])).toEqual({
      type: "resume_task",
      taskId: "task-1"
    });
  });
});
