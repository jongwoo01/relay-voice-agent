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
          response: JSON.stringify({
            summary: "브라우저 탭 3개를 닫고 2개를 고정했어.",
            verification: "verified",
            changes: ["닫은 탭 3개", "고정한 탭 2개"],
            question: ""
          })
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
            response: JSON.stringify({
              summary: "브라우저 탭 3개를 닫고 2개를 고정했어.",
              verification: "verified",
              changes: ["닫은 탭 3개", "고정한 탭 2개"],
              question: ""
            })
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
        expect.stringContaining("User task:\nOrganize my browser tabs"),
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ],
      expect.objectContaining({
        cwd: undefined,
        env: expect.objectContaining({
          GOOGLE_GENAI_USE_GCA: "true"
        }),
        onStdoutLine: expect.any(Function)
      })
    );
    expect(exec.mock.calls[0]?.[2]?.env?.GEMINI_API_KEY).toBeUndefined();
    expect(exec.mock.calls[0]?.[2]?.env?.GOOGLE_API_KEY).toBeUndefined();
    expect(exec.mock.calls[0]?.[2]?.env?.GOOGLE_GENAI_USE_VERTEXAI).toBeUndefined();
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
        message: "브라우저 탭 3개를 닫고 2개를 고정했어.",
        createdAt: "2026-03-08T00:00:00.000Z"
      },
      sessionId: "session-123",
      outcome: "completed",
      report: {
        summary: "브라우저 탭 3개를 닫고 2개를 고정했어.",
        verification: "verified",
        changes: ["닫은 탭 3개", "고정한 탭 2개"],
        question: undefined
      }
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
        response: JSON.stringify({
          summary: "이어서 정리 작업을 끝냈어.",
          verification: "verified",
          changes: ["정리 완료"],
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
      workingDirectory: "/tmp/work"
    });

    expect(exec).toHaveBeenCalledWith(
      "gemini",
      [
        "-r",
        "session-999",
        "-p",
        expect.stringContaining("User task:\nContinue cleanup"),
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ],
      expect.objectContaining({
        cwd: "/tmp/work",
        env: expect.objectContaining({
          GOOGLE_GENAI_USE_GCA: "true"
        }),
        onStdoutLine: expect.any(Function)
      })
    );
  });

  it("strips live api key auth env before spawning Gemini CLI", async () => {
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

      const env = exec.mock.calls[0]?.[2]?.env;
      expect(env?.GOOGLE_GENAI_USE_GCA).toBe("true");
      expect(env?.GEMINI_API_KEY).toBeUndefined();
      expect(env?.GOOGLE_API_KEY).toBeUndefined();
      expect(env?.GOOGLE_GENAI_USE_VERTEXAI).toBeUndefined();
      expect(env?.GOOGLE_CLOUD_PROJECT).toBeUndefined();
      expect(env?.GOOGLE_CLOUD_PROJECT_ID).toBeUndefined();
      expect(env?.GOOGLE_CLOUD_LOCATION).toBeUndefined();
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
        response: "문서, 이미지, 기타 세 폴더로 분류했습니다. 확인해 보세요!"
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
      "작업은 끝났지만 구조화된 결과 보고가 없어서 실제 변경 사항 확인이 더 필요해."
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
