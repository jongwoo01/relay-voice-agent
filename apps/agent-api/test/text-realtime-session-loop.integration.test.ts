import { describe, expect, it } from "vitest";
import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type {
  AssistantNotification,
  FinalizedUtterance
} from "@agent/shared-types";
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
    const notifications: AssistantNotification[] = [];

    class DeferredExecutor implements LocalExecutor {
      async run(
        request: ExecutorRunRequest,
        onProgress?: ExecutorProgressListener
      ): Promise<ExecutorRunResult> {
        const progressEvent = {
          taskId: request.task.id,
          type: "executor_progress" as const,
          message: "정리 중",
          createdAt: request.now
        };
        if (onProgress) {
          await onProgress(progressEvent);
        }

        return await new Promise<ExecutorRunResult>((resolve) => {
          resolveExecution = () =>
            resolve({
              progressEvents: [progressEvent],
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

    const loop = new TextRealtimeSessionLoop(
      new DeferredExecutor(),
      undefined,
      async (notification) => {
        notifications.push(notification);
      }
    );

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

    expect(secondTurn.assistant?.tone).toBe("reply");
    expect(secondTurn.assistant?.text).toContain("구체적으로");

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
    await expect(loop.listTaskEvents(firstTurn.task!.id)).resolves.toEqual([
      expect.objectContaining({ type: "task_created" }),
      expect.objectContaining({ type: "task_queued" }),
      expect.objectContaining({ type: "task_started" }),
      expect.objectContaining({ type: "executor_progress", message: "정리 중" })
    ]);

    resolveExecution?.();
    await loop.waitForBackgroundWork();

    const activeTasksAfterCompletion = await loop.listActiveTasks("brain-1");
    expect(activeTasksAfterCompletion).toHaveLength(0);

    const conversationAfterCompletion = await loop.listConversation("brain-1");
    expect(conversationAfterCompletion.map((message) => message.text)).toContain(
      "좋아, 끝냈어. 정리 완료"
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        priority: "normal",
        delivery: "next_turn",
        reason: "task_completed"
      })
    ]);

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
