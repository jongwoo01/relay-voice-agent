import { describe, expect, it, vi } from "vitest";
import { GeminiCliExecutor } from "../src/subprocess-executor.js";

describe("GeminiCliExecutor", () => {
  it("executes a new task request and maps stream-json output to the executor contract", async () => {
    const exec = vi.fn(async (_file, _args, options) => {
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "init",
          session_id: "session-123"
        })
      );
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "tool_use",
          name: "browser.inspect_tabs"
        })
      );
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "result",
          response: "브라우저 탭 정리를 마쳤어요"
        })
      );

      return {
        stdout: [
          JSON.stringify({
            type: "init",
            session_id: "session-123"
          }),
          JSON.stringify({
            type: "tool_use",
            name: "browser.inspect_tabs"
          }),
          JSON.stringify({
            type: "result",
            response: "브라우저 탭 정리를 마쳤어요"
          })
        ].join("\n"),
        stderr: "",
        exitCode: 0
      };
    });

    const executor = new GeminiCliExecutor(exec);
    const onProgress = vi.fn();

    const result = await executor.run(
      {
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
      },
      onProgress
    );

    expect(exec).toHaveBeenCalledWith(
      "gemini",
      [
        "-p",
        "Organize my browser tabs",
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ],
      expect.objectContaining({
        cwd: undefined,
        onStdoutLine: expect.any(Function)
      })
    );
    expect(result).toEqual({
      progressEvents: [
        {
          taskId: "task-1",
          type: "executor_progress",
          message: "Tool requested: browser.inspect_tabs",
          createdAt: "2026-03-08T00:00:00.000Z"
        }
      ],
      completionEvent: {
        taskId: "task-1",
        type: "executor_completed",
        message: "브라우저 탭 정리를 마쳤어요",
        createdAt: "2026-03-08T00:00:00.000Z"
      },
      sessionId: "session-123"
    });
    expect(onProgress).toHaveBeenCalledWith({
      taskId: "task-1",
      type: "executor_progress",
      message: "Tool requested: browser.inspect_tabs",
      createdAt: "2026-03-08T00:00:00.000Z"
    });
  });

  it("uses -r when resumeSessionId is provided", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        type: "result",
        response: "이어서 완료했어요"
      }),
      stderr: "",
      exitCode: 0
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
      [
        "-r",
        "session-999",
        "-p",
        "Continue cleanup",
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ],
      expect.objectContaining({
        cwd: "/tmp/work",
        onStdoutLine: expect.any(Function)
      })
    );
  });

  it("fails when the process exits cleanly but produces no output", async () => {
    const exec = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));

    const executor = new GeminiCliExecutor(exec);

    await expect(
      executor.run({
        task: {
          id: "task-3",
          title: "Inspect desktop folders",
          normalizedGoal: "inspect desktop folders",
          status: "queued",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        now: "2026-03-08T00:00:00.000Z",
        prompt: "List folders on the desktop"
      })
    ).rejects.toThrow("Gemini CLI output was empty");
  });
});
