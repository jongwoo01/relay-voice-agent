import { describe, expect, it, vi } from "vitest";
import { resolveGeminiCliCommand } from "../src/command-builder.js";
import {
  buildGeminiCliEnvironment,
  GeminiCliExecutor,
  type RunCommandOptions
} from "../src/subprocess-executor.js";

describe("GeminiCliExecutor", () => {
  it("adds common Homebrew node paths so the gemini shebang can resolve node", () => {
    const env = buildGeminiCliEnvironment({
      PATH: "/usr/bin:/bin"
    });

    if (process.platform === "darwin") {
      const pathEntries = env.PATH?.split(":") ?? [];
      expect(pathEntries).toContain("/opt/homebrew/opt/node/bin");
      expect(pathEntries).toContain("/opt/homebrew/opt/node@22/bin");
    }
  });

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
          response: `I closed three noisy tabs and pinned two important tabs.\nREPORT_JSON: ${JSON.stringify({
            summary: "Closed 3 browser tabs and pinned 2.",
            keyFindings: ["Closed 3 browser tabs", "Pinned 2 tabs"],
            verification: "verified",
            changes: ["Closed 3 tabs", "Pinned 2 tabs"],
            question: ""
          })}`
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
            response: `I closed three noisy tabs and pinned two important tabs.\nREPORT_JSON: ${JSON.stringify({
              summary: "Closed 3 browser tabs and pinned 2.",
              keyFindings: ["Closed 3 browser tabs", "Pinned 2 tabs"],
              verification: "verified",
              changes: ["Closed 3 tabs", "Pinned 2 tabs"],
              question: ""
            })}`
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

    const call = exec.mock.calls[0] as unknown as
      | [string, string[], RunCommandOptions?]
      | undefined;
    expect(call).toBeDefined();
    const [command, args, options] = call!;
    expect(command).toBe(resolveGeminiCliCommand());
    expect(args).toEqual([
      "-p",
      expect.stringContaining("User task:\nOrganize my browser tabs"),
      "--approval-mode",
      "yolo",
      "--output-format",
      "stream-json"
    ]);
    expect(options?.cwd).toBeUndefined();
    expect(options?.onStdoutLine).toEqual(expect.any(Function));
    expect(options?.env?.PATH).toEqual(expect.any(String));
    expect(result).toEqual(
      expect.objectContaining({
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
          message: "Closed 3 browser tabs and pinned 2.",
          createdAt: "2026-03-08T00:00:00.000Z"
        },
        sessionId: "session-123",
        outcome: "completed",
        report: expect.objectContaining({
          summary: "Closed 3 browser tabs and pinned 2.",
          detailedAnswer: "I closed three noisy tabs and pinned two important tabs.",
          keyFindings: ["Closed 3 browser tabs", "Pinned 2 tabs"],
          verification: "verified",
          changes: ["Closed 3 tabs", "Pinned 2 tabs"],
          question: undefined
        }),
        artifacts: expect.any(Array)
      })
    );
    expect(result.artifacts?.length).toBe(3);
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
        response: JSON.stringify({
          summary: "Finished the cleanup after resuming.",
          verification: "verified",
          changes: ["Cleanup completed"],
          question: ""
        })
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
      workingDirectory: "/tmp"
    });

    const call = exec.mock.calls[0] as unknown as
      | [string, string[], RunCommandOptions?]
      | undefined;
    expect(call).toBeDefined();
    const [command, args, options] = call!;
    expect(command).toBe(resolveGeminiCliCommand());
    expect(args).toEqual([
      "-r",
      "session-999",
      "-p",
      expect.stringContaining("User task:\nContinue cleanup"),
      "--approval-mode",
      "yolo",
      "--output-format",
      "stream-json"
    ]);
    expect(options?.cwd).toBe("/tmp");
    expect(options?.env?.PATH).toEqual(expect.any(String));
    expect(options?.onStdoutLine).toEqual(expect.any(Function));
  });

  it("preserves configured auth env before spawning Gemini CLI", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        type: "result",
        response: JSON.stringify({
          summary: "OK",
          verification: "verified",
          changes: [],
          question: ""
        })
      }),
      stderr: "",
      exitCode: 0
    }));

    vi.stubEnv("GEMINI_API_KEY", "live-key");
    vi.stubEnv("GOOGLE_API_KEY", "google-live-key");
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "project-123");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "project-123");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");

    try {
      const executor = new GeminiCliExecutor(exec);

      await executor.run({
        task: {
          id: "task-auth",
          title: "Auth cleanup",
          normalizedGoal: "auth cleanup",
          status: "queued",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        now: "2026-03-08T00:00:00.000Z",
        prompt: "Reply with OK"
      });

      const env = (exec.mock.calls[0] as any)?.[2]?.env;
      expect(env?.GEMINI_API_KEY).toBe("live-key");
      expect(env?.GOOGLE_API_KEY).toBe("google-live-key");
      expect(env?.GOOGLE_GENAI_USE_VERTEXAI).toBe("true");
      expect(env?.GOOGLE_CLOUD_PROJECT).toBe("project-123");
      expect(env?.GOOGLE_CLOUD_PROJECT_ID).toBe("project-123");
      expect(env?.GOOGLE_CLOUD_LOCATION).toBe("us-central1");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("attaches taskId to raw executor events", async () => {
    const exec = vi.fn(async (_file, _args, options) => {
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "tool_use",
          name: "run_shell_command"
        })
      );
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "result",
          response: JSON.stringify({
            summary: "OK",
            verification: "verified",
            changes: [],
            question: ""
          })
        })
      );

      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });
    const onRawEvent = vi.fn();
    const executor = new GeminiCliExecutor(exec, onRawEvent);

    await executor.run({
      task: {
        id: "task-raw",
        title: "Attach task id",
        normalizedGoal: "attach task id",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Reply with OK"
    });

    expect(onRawEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_use",
        payload: expect.objectContaining({
          name: "run_shell_command",
          taskId: "task-raw"
        })
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

  it("falls back to a conservative completion message when the final response is not structured JSON", async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        type: "result",
        response: "Sorted them into Documents, Images, and Other. Please take a look!"
      }),
      stderr: "",
      exitCode: 0
    }));

    const executor = new GeminiCliExecutor(exec);

    const result = await executor.run({
      task: {
        id: "task-4",
        title: "Organize downloads",
        normalizedGoal: "organize downloads",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Organize my downloads"
    });

    expect(result.completionEvent.message).toBe(
      "The task finished, but the structured result report was missing, so the final changes still need verification."
    );
    expect(result.report).toBeUndefined();
  });

  it("fails fast when streamed output contains hard delivery failure evidence", async () => {
    const exec = vi.fn(async (_file, _args, options) => {
      await options?.onStdoutLine?.(
        JSON.stringify({
          type: "tool_result",
          status: "success",
          output:
            "MAILER-DAEMON: Undelivered Mail Returned to Sender for hijw0328@gmail.com"
        })
      );

      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    });

    const executor = new GeminiCliExecutor(exec);

    await expect(
      executor.run({
        task: {
          id: "task-mail-fail",
          title: "Send email",
          normalizedGoal: "send email",
          status: "queued",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        now: "2026-03-08T00:00:00.000Z",
        prompt: "Send the email"
      })
    ).rejects.toThrow("Task failed: the attempted email delivery bounced.");
  });
});
