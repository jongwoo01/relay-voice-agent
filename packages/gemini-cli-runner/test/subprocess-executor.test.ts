import { describe, expect, it, vi } from "vitest";
import { GeminiCliExecutor } from "../src/subprocess-executor.js";

describe("GeminiCliExecutor", () => {
  it("executes a new task request and maps the parsed output to the executor contract", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        session_id: "session-123",
        text: "브라우저 탭 정리를 마쳤어요"
      }),
      stderr: ""
    }));

    const executor = new GeminiCliExecutor(exec);

    const result = await executor.run({
      task: {
        id: "task-1",
        title: "Organize tabs",
        normalizedGoal: "organize tabs",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Organize my browser tabs"
    });

    expect(exec).toHaveBeenCalledWith(
      "gemini",
      ["-p", "Organize my browser tabs", "--output-format", "json"],
      { cwd: undefined }
    );
    expect(result).toEqual({
      progressEvents: [],
      completionEvent: {
        taskId: "task-1",
        type: "executor_completed",
        message: "브라우저 탭 정리를 마쳤어요",
        createdAt: "2026-03-08T00:00:00.000Z"
      },
      sessionId: "session-123"
    });
  });

  it("uses -r when resumeSessionId is provided", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        message: "이어서 완료했어요"
      }),
      stderr: ""
    }));

    const executor = new GeminiCliExecutor(exec);

    await executor.run({
      task: {
        id: "task-2",
        title: "Continue cleanup",
        normalizedGoal: "continue cleanup",
        status: "running",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Continue cleanup",
      resumeSessionId: "session-999",
      workingDirectory: "/tmp/work"
    });

    expect(exec).toHaveBeenCalledWith(
      "gemini",
      ["-r", "session-999", "Continue cleanup", "--output-format", "json"],
      { cwd: "/tmp/work" }
    );
  });
});
