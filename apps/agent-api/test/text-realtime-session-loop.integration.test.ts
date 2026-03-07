import { describe, expect, it } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import { TextRealtimeSessionLoop } from "../src/index.js";

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

describe("text-realtime-session-loop", () => {
  it("accepts a second conversational turn while a task is running in the background", async () => {
    let resolveExecution: (() => void) | undefined;

    class DeferredExecutor implements LocalExecutor {
      async run(request: ExecutorRunRequest): Promise<ExecutorRunResult> {
        return await new Promise<ExecutorRunResult>((resolve) => {
          resolveExecution = () =>
            resolve({
              progressEvents: [
                {
                  taskId: request.task.id,
                  type: "executor_progress",
                  message: "정리 중",
                  createdAt: request.now
                }
              ],
              completionEvent: {
                taskId: request.task.id,
                type: "executor_completed",
                message: "정리 완료",
                createdAt: request.now
              },
              sessionId: request.resumeSessionId ?? "session-new"
            });
        });
      }
    }

    const loop = new TextRealtimeSessionLoop(new DeferredExecutor());

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("브라우저 탭 정리해줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant).toEqual({
      text: "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
      tone: "task_ack"
    });
    expect(firstTurn.task?.status).toBe("running");

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("고마워", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant).toEqual({
      text: "메인 대화 레이어에서 바로 응답하면 됩니다.",
      tone: "reply"
    });

    const conversationBeforeCompletion = await loop.listConversation("brain-1");
    expect(conversationBeforeCompletion.map((message) => message.speaker)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);

    const activeTasksBeforeCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksBeforeCompletion).toHaveLength(1);
    expect(activeTasksBeforeCompletion[0]?.status).toBe("running");

    resolveExecution?.();
    await loop.waitForBackgroundWork();

    const activeTasksAfterCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksAfterCompletion).toHaveLength(0);

    const taskEvents = await loop.listTaskEvents(firstTurn.task!.id);
    expect(taskEvents.map((event) => event.type)).toEqual([
      "task_created",
      "task_queued",
      "task_started",
      "executor_progress",
      "executor_completed"
    ]);
  });
});
