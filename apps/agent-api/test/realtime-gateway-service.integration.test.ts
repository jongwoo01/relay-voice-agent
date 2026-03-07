import { describe, expect, it, vi } from "vitest";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  BrainTurnService,
  ConversationOrchestrator,
  FinalizedUtteranceHandler,
  InMemoryTaskExecutorSessionRepository,
  InMemoryTaskRepository,
  RealtimeGatewayService,
  TaskExecutionService,
  TaskRuntime
} from "../src/index.js";

class CapturingExecutor implements LocalExecutor {
  public readonly run = vi.fn(
    async (
      request: ExecutorRunRequest
    ): Promise<ExecutorRunResult> => ({
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: "실행 완료",
        createdAt: request.now
      },
      sessionId: request.resumeSessionId ?? "session-created"
    })
  );
}

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-08T00:00:00.000Z"
  };
}

describe("realtime-gateway-service", () => {
  it("handles a finalized utterance and returns a UI-ready assistant envelope", async () => {
    const gateway = new RealtimeGatewayService();

    const result = await gateway.handleFinalizedUtterance({
      brainSessionId: "brain-1",
      utterance: utterance("안녕", "small_talk"),
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result).toEqual({
      assistant: {
        text: "메인 대화 레이어에서 바로 응답하면 됩니다.",
        tone: "reply"
      }
    });
  });

  it("looks up active tasks from repository and routes a continuation utterance through the handler", async () => {
    const taskRepository = new InMemoryTaskRepository();
    await taskRepository.save("brain-1", {
      id: "task-existing",
      title: "브라우저 정리",
      normalizedGoal: "browser cleanup",
      status: "running",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });

    const executorSessionRepository = new InMemoryTaskExecutorSessionRepository();
    await executorSessionRepository.save({
      taskId: "task-existing",
      sessionId: "session-existing",
      workingDirectory: "/tmp/browser",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });

    const executor = new CapturingExecutor();
    const gateway = new RealtimeGatewayService(
      new FinalizedUtteranceHandler(
        new BrainTurnService(
          new ConversationOrchestrator(),
          new TaskExecutionService(
            new TaskRuntime(executor),
            executorSessionRepository
          )
        )
      ),
      taskRepository
    );

    const result = await gateway.handleFinalizedUtterance({
      brainSessionId: "brain-1",
      utterance: utterance("아까 하던 거 이어서 해", "task_request"),
      now: "2026-03-08T00:01:00.000Z"
    });

    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: "session-existing",
        workingDirectory: "/tmp/browser"
      }),
      expect.any(Function)
    );
    expect(result.assistant).toEqual({
      text: "이어서 진행할게. 작업 상태는 패널에 보여줄게.",
      tone: "task_ack"
    });
    expect(result.task?.id).toBe("task-existing");
  });
});
