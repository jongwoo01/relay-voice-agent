import { describe, expect, it, vi } from "vitest";
import {
  buildExecutorResultFromGeminiCliOutput,
  parseGeminiCliOutput
} from "../src/output-parser.js";

describe("parseGeminiCliOutput", () => {
  it("parses stream-json output into structured headless events", () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "init",
          session_id: "session-123",
          model: "gemini-2.5-pro"
        }),
        JSON.stringify({
          type: "tool_use",
          name: "browser.inspect_tabs"
        }),
        JSON.stringify({
          type: "result",
          response: "브라우저 탭 정리를 마쳤어요"
        })
      ].join("\n")
    );

    expect(parsed.events).toEqual([
      {
        type: "init",
        payload: {
          session_id: "session-123",
          model: "gemini-2.5-pro"
        }
      },
      {
        type: "tool_use",
        payload: {
          name: "browser.inspect_tabs"
        }
      },
      {
        type: "result",
        payload: {
          response: "브라우저 탭 정리를 마쳤어요"
        }
      }
    ]);
  });

  it("throws when the output is empty", () => {
    expect(() => parseGeminiCliOutput("")).toThrow("Gemini CLI output was empty");
  });
});

describe("buildExecutorResultFromGeminiCliOutput", () => {
  it("maps tool events to progress and result to completion", async () => {
    const onProgress = vi.fn();
    const structuredReport = JSON.stringify({
      summary: "브라우저 탭 정리를 마쳤어요",
      verification: "verified",
      changes: ["브라우저 탭 상태를 확인했어요"],
      question: ""
    });
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "init",
          session_id: "session-123"
        }),
        JSON.stringify({
          type: "tool_use",
          name: "browser.inspect_tabs"
        }),
        JSON.stringify({
          type: "tool_result",
          name: "browser.inspect_tabs"
        }),
        JSON.stringify({
          type: "result",
          response: structuredReport
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-1",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed,
      onProgress
    });

    expect(result.sessionId).toBe("session-123");
    expect(result.progressEvents.map((event) => event.message)).toEqual([
      "Tool requested: browser.inspect_tabs",
      "Tool finished: browser.inspect_tabs"
    ]);
    expect(result.completionEvent.message).toBe("브라우저 탭 정리를 마쳤어요");
    expect(result.report).toEqual({
      summary: "브라우저 탭 정리를 마쳤어요",
      verification: "verified",
      changes: ["브라우저 탭 상태를 확인했어요"],
      question: undefined
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("throws when a tool_result reports error status", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "tool_use",
          tool_name: "list_directory"
        }),
        JSON.stringify({
          type: "tool_result",
          tool_name: "list_directory",
          status: "error",
          output: "Path not in workspace"
        }),
        JSON.stringify({
          type: "result",
          status: "success"
        })
      ].join("\n")
    );

    await expect(
      buildExecutorResultFromGeminiCliOutput({
        taskId: "task-2",
        now: "2026-03-08T00:00:00.000Z",
        output: parsed
      })
    ).rejects.toThrow(
      "Gemini CLI tool failure (list_directory): Path not in workspace"
    );
  });

  it("throws when no final result event is present", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "partial response"
        })
      ].join("\n")
    );

    await expect(
      buildExecutorResultFromGeminiCliOutput({
        taskId: "task-3",
        now: "2026-03-08T00:00:00.000Z",
        output: parsed
      })
    ).rejects.toThrow("Gemini CLI output did not include a final result event");
  });

  it("maps non-terminal executor outcomes for approval and follow-up input", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "result",
          status: "approval_required",
          response: "이 파일들을 삭제해도 되는지 확인해줘"
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-4",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.outcome).toBe("approval_required");
    expect(result.completionEvent.type).toBe("executor_approval_required");
    expect(result.completionEvent.message).toBe(
      "이 파일들을 삭제해도 되는지 확인해줘"
    );
  });

  it("extracts a structured report when JSON is embedded in extra prose", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "result",
          response:
            '확인 결과는 아래와 같아요. {"summary":"바탕화면 항목을 확인했어요","verification":"verified","changes":["Desktop 디렉터리 항목을 읽었어요"],"question":""}'
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-5",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.completionEvent.message).toBe("바탕화면 항목을 확인했어요");
    expect(result.report).toEqual({
      summary: "바탕화면 항목을 확인했어요",
      verification: "verified",
      changes: ["Desktop 디렉터리 항목을 읽었어요"],
      question: undefined
    });
  });

  it("falls back to assistant message chunks when the final result only carries status", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "message",
          role: "assistant",
          text: '{"summary":"바탕화면 항목을 확인했어요","verification":"verified",'
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          text: '"changes":["Desktop 디렉터리 항목을 읽었어요"],"question":""}'
        }),
        JSON.stringify({
          type: "result",
          status: "success"
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-6",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.completionEvent.message).toBe("바탕화면 항목을 확인했어요");
    expect(result.report).toEqual({
      summary: "바탕화면 항목을 확인했어요",
      verification: "verified",
      changes: ["Desktop 디렉터리 항목을 읽었어요"],
      question: undefined
    });
  });
});
