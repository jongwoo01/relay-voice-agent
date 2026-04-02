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
          response: "Finished cleaning up the browser tabs"
        })
      ].join("\n")
    );

    expect(parsed).toEqual({
      events: [
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
          response: "Finished cleaning up the browser tabs"
        }
      }
      ],
      usedSyntheticResult: false,
      unparsedLines: [],
      hasRealResultEvent: true,
      detectedFormat: "stream-json"
    });
  });

  it("parses documented headless json output into a final result event", () => {
    const parsed = parseGeminiCliOutput(
      [
        "Loaded cached credentials.",
        JSON.stringify(
          {
            response:
              'I checked the desktop.\nREPORT_JSON: {"summary":"Checked the desktop.","verification":"verified","changes":["Read the Desktop directory entries"],"question":""}',
            stats: {
              tools: {
                totalCalls: 1
              }
            }
          },
          null,
          2
        )
      ].join("\n")
    );

    expect(parsed).toEqual({
      events: [
        {
          type: "result",
          payload: {
            response:
              'I checked the desktop.\nREPORT_JSON: {"summary":"Checked the desktop.","verification":"verified","changes":["Read the Desktop directory entries"],"question":""}',
            stats: {
              tools: {
                totalCalls: 1
              }
            }
          }
        }
      ],
      usedSyntheticResult: false,
      unparsedLines: [],
      hasRealResultEvent: true,
      detectedFormat: "json"
    });
  });

  it("throws when the output is empty", () => {
    expect(() => parseGeminiCliOutput("")).toThrow("Gemini CLI output was empty");
  });

  it("falls back to a synthetic final result when Gemini CLI emits plain text", () => {
    const parsed = parseGeminiCliOutput(
      'I am Gemini, and I checked the Downloads folder.\nREPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
    );

    expect(parsed).toEqual({
      events: [
        {
          type: "result",
          payload: {
            response:
              'I am Gemini, and I checked the Downloads folder.\nREPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
          }
        }
      ],
      usedSyntheticResult: true,
      unparsedLines: [
        "I am Gemini, and I checked the Downloads folder.",
        'REPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
      ],
      hasRealResultEvent: false,
      detectedFormat: "text"
    });
  });

  it("keeps parsed stream events and appends a synthetic result for trailing plain text", () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "tool_use",
          name: "list_directory"
        }),
        'I am Gemini, and I checked the Downloads folder.\nREPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
      ].join("\n")
    );

    expect(parsed).toEqual({
      events: [
        {
          type: "tool_use",
          payload: {
            name: "list_directory"
          }
        },
        {
          type: "result",
          payload: {
            response:
              'I am Gemini, and I checked the Downloads folder.\nREPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
          }
        }
      ],
      usedSyntheticResult: true,
      unparsedLines: [
        "I am Gemini, and I checked the Downloads folder.",
        'REPORT_JSON: {"summary":"Listed the Downloads folder.","verification":"verified","changes":["Read the Downloads directory entries"],"question":""}'
      ],
      hasRealResultEvent: false,
      detectedFormat: "stream-json"
    });
  });
});

describe("buildExecutorResultFromGeminiCliOutput", () => {
  it("maps tool events to progress and result to completion", async () => {
    const onProgress = vi.fn();
    const structuredReport = JSON.stringify({
      summary: "Finished cleaning up the browser tabs",
      keyFindings: ["Closed 3 noisy tabs", "Pinned 2 important tabs"],
      verification: "verified",
      changes: ["Checked the browser tab state"],
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
          response: `I closed the noisy tabs and kept the important ones pinned.\nREPORT_JSON: ${structuredReport}`
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
    expect(result.completionEvent.message).toBe("Finished cleaning up the browser tabs");
    expect(result.report).toEqual(
      expect.objectContaining({
        summary: "Finished cleaning up the browser tabs",
        detailedAnswer: "I closed the noisy tabs and kept the important ones pinned.",
        keyFindings: ["Closed 3 noisy tabs", "Pinned 2 important tabs"],
        verification: "verified",
        changes: ["Checked the browser tab state"],
        question: undefined
      })
    );
    expect(result.artifacts?.length).toBe(4);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("maps documented headless json output to a completed executor result", async () => {
    const parsed = parseGeminiCliOutput(
      JSON.stringify({
        response:
          'I checked the desktop.\nREPORT_JSON: {"summary":"Checked the desktop.","verification":"verified","changes":["Read the Desktop directory entries"],"question":""}',
        stats: {
          tools: {
            totalCalls: 1
          }
        }
      })
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-json",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed,
      expectedFormat: "json"
    });

    expect(result.outcome).toBe("completed");
    expect(result.completionEvent.message).toBe("Checked the desktop.");
    expect(result.report).toEqual(
      expect.objectContaining({
        summary: "Checked the desktop.",
        verification: "verified",
        changes: ["Read the Desktop directory entries"]
      })
    );
  });

  it("resolves tool_result names through tool_id when the result omits the tool name", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "tool_use",
          tool_id: "tool-123",
          name: "list_directory"
        }),
        JSON.stringify({
          type: "tool_result",
          tool_id: "tool-123",
          status: "success",
          output: "Listed 5 item(s)."
        }),
        JSON.stringify({
          type: "result",
          response:
            'I checked the Desktop items.\nREPORT_JSON: {"summary":"Checked the Desktop items.","verification":"verified","changes":["Read the Desktop directory entries"],"question":""}'
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-tool-id",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.progressEvents.map((event) => event.message)).toEqual([
      "Tool requested: list_directory",
      "Tool finished: list_directory"
    ]);
    expect(result.artifacts?.[1]).toEqual(
      expect.objectContaining({
        kind: "tool_result",
        title: "Tool result: list_directory",
        toolName: "list_directory"
      })
    );
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
          response: "Please confirm whether these files can be deleted"
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
      "Please confirm whether these files can be deleted"
    );
  });

  it("extracts a structured report when JSON is embedded in extra prose", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "result",
          response:
            'Here are the verified results. {"summary":"Checked the desktop items","verification":"verified","changes":["Read the Desktop directory entries"],"question":""}'
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-5",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.completionEvent.message).toBe("Checked the desktop items");
    expect(result.report).toEqual(
      expect.objectContaining({
        summary: "Checked the desktop items",
        detailedAnswer: "Here are the verified results.",
        verification: "verified",
        changes: ["Read the Desktop directory entries"],
        question: undefined
      })
    );
  });

  it("falls back to assistant message chunks when the final result only carries status", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "message",
          role: "assistant",
          text: '{"summary":"Checked the desktop items","verification":"verified",'
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          text: '"changes":["Read the Desktop directory entries"],"question":""}'
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

    expect(result.completionEvent.message).toBe("Checked the desktop items");
    expect(result.report).toEqual(
      expect.objectContaining({
        summary: "Checked the desktop items",
        verification: "verified",
        changes: ["Read the Desktop directory entries"],
        question: undefined
      })
    );
    expect(result.report?.detailedAnswer).toBeUndefined();
  });

  it("rejects synthetic fallback output when no structured completion report can be recovered", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "tool_use",
          name: "list_directory"
        }),
        "How can I help you today?"
      ].join("\n")
    );

    await expect(
      buildExecutorResultFromGeminiCliOutput({
        taskId: "task-protocol-error",
        now: "2026-03-08T00:00:00.000Z",
        output: parsed
      })
    ).rejects.toThrow(
      'Gemini CLI did not return usable structured output in stream-json mode. First non-JSON stdout line: "How can I help you today?". Relay received 1 structured event before the output became unusable.'
    );
  });

  it("preserves multilingual structured reports", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "result",
          response:
            '파일을 만들었습니다.\nREPORT_JSON: {"summary":"데스크톱에 타고있는내맘.txt 파일을 만들었습니다.","keyFindings":["파일 이름: 타고있는내맘.txt","위치: /Users/jongwoo/Desktop/타고있는내맘.txt"],"verification":"verified","changes":["사랑 편지 5줄을 파일에 작성했습니다."],"question":""}'
        })
      ].join("\n")
    );

    const result = await buildExecutorResultFromGeminiCliOutput({
      taskId: "task-ko",
      now: "2026-03-08T00:00:00.000Z",
      output: parsed
    });

    expect(result.completionEvent.message).toBe(
      "데스크톱에 타고있는내맘.txt 파일을 만들었습니다."
    );
    expect(result.report).toEqual(
      expect.objectContaining({
        summary: "데스크톱에 타고있는내맘.txt 파일을 만들었습니다.",
        detailedAnswer: "파일을 만들었습니다.",
        keyFindings: [
          "파일 이름: 타고있는내맘.txt",
          "위치: /Users/jongwoo/Desktop/타고있는내맘.txt"
        ],
        verification: "verified",
        changes: ["사랑 편지 5줄을 파일에 작성했습니다."],
        question: undefined
      })
    );
  });

  it("throws when the final result reports error status", async () => {
    const parsed = parseGeminiCliOutput(
      [
        JSON.stringify({
          type: "result",
          status: "error",
          error: {
            message: "Failed to write the requested file."
          }
        })
      ].join("\n")
    );

    await expect(
      buildExecutorResultFromGeminiCliOutput({
        taskId: "task-final-error",
        now: "2026-03-08T00:00:00.000Z",
        output: parsed
      })
    ).rejects.toThrow(
      "Gemini CLI final result error: Failed to write the requested file."
    );
  });
});
