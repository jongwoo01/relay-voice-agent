import { describe, expect, it } from "vitest";
import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import { TextRealtimeSessionLoop } from "../src/index.js";

function utterance(
  text: string,
  intent: FinalizedUtterance["intent"]
): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

class QueueDeferredExecutor implements LocalExecutor {
  public readonly calls: ExecutorRunRequest[] = [];
  private readonly resolvers: Array<() => void> = [];

  async run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    this.calls.push(request);
    const progressEvent = {
      taskId: request.task.id,
      type: "executor_progress" as const,
      message: "작업 중",
      createdAt: request.now
    };
    if (onProgress) {
      await onProgress(progressEvent);
    }

    return await new Promise<ExecutorRunResult>((resolve) => {
      this.resolvers.push(() =>
        resolve({
          progressEvents: [progressEvent],
          completionEvent: {
            taskId: request.task.id,
            type: "executor_completed",
            message: "완료",
            createdAt: request.now
          },
          sessionId: request.resumeSessionId ?? "session-created"
        })
      );
    });
  }

  resolveAll() {
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.();
    }
  }
}

describe("text-realtime-session-loop follow-up behavior", () => {
  it("handles short follow-up and completion notice naturally while task is running", async () => {
    const executor = new QueueDeferredExecutor();
    const loop = new TextRealtimeSessionLoop(executor);

    const firstTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("데스크톱에서 폴더 확인해줘", "task_request"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(firstTurn.assistant.tone).toBe("task_ack");
    expect(firstTurn.task?.status).toBe("running");
    expect(executor.calls).toHaveLength(1);

    const secondTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("줘", "small_talk"),
      now: "2026-03-08T00:00:01.000Z"
    });

    expect(secondTurn.assistant.tone).toBe("task_ack");
    expect(secondTurn.task?.id).toBe(firstTurn.task?.id);
    expect(executor.calls).toHaveLength(2);

    const thirdTurn = await loop.handleTurn({
      brainSessionId: "brain-1",
      utterance: utterance("완료되면 알려줘", "task_request"),
      now: "2026-03-08T00:00:02.000Z"
    });

    expect(thirdTurn.assistant.tone).toBe("reply");
    expect(thirdTurn.assistant.text).toContain("끝나면 바로 알려드릴게요");
    expect(thirdTurn.task).toBeUndefined();
    expect(executor.calls).toHaveLength(2);

    executor.resolveAll();
    await loop.waitForBackgroundWork();
  });
});
