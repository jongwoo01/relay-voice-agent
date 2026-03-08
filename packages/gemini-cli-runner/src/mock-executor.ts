import type {
  ExecutorProgressListener,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { Task } from "@agent/shared-types";
import {
  buildExecutorResultFromGeminiCliOutput,
  createMockGeminiCliOutput,
  createToolResultEvent,
  createToolUseEvent
} from "./output-parser.js";

export class MockExecutor implements LocalExecutor {
  async run(
    request: { task: Task; now: string; resumeSessionId?: string },
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    return buildExecutorResultFromGeminiCliOutput({
      taskId: request.task.id,
      now: request.now,
      onProgress,
      output: createMockGeminiCliOutput([
        {
          type: "init",
          payload: {
            session_id: request.resumeSessionId ?? "mock-session-1",
            model: "gemini-mock"
          }
        },
        createToolUseEvent("browser.inspect_tabs", {
          mode: "cleanup"
        }),
        createToolResultEvent("browser.inspect_tabs", {
          tabCount: 17
        }),
        {
          type: "result",
          payload: {
            response: "작업을 완료했어요"
          }
        }
      ])
    });
  }
}
