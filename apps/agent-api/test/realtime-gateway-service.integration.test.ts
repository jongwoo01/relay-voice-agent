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
  InMemoryTaskEventRepository,
  InMemoryTaskExecutorSessionRepository,
  InMemoryTaskRepository,
  RealtimeGatewayService,
  TaskExecutionService,
  TaskRuntime,
  type TaskRoutingDecision,
  type TaskRoutingResolver
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

function createRoutingDecision(
  overrides: Partial<TaskRoutingDecision> = {}
): TaskRoutingDecision {
  return {
    kind: "create_task",
    targetTaskId: null,
    clarificationNeeded: false,
    clarificationText: null,
    executorPrompt: null,
    reason: "test routing decision",
    ...overrides
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

    expect(result.assistant?.tone).toBe("reply");
    expect(result.assistant?.text).toContain("안녕하세요");
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
          ),
          undefined,
          {
            resolve: async () =>
              createRoutingDecision({
                kind: "continue_task",
                targetTaskId: "task-existing",
                executorPrompt: "아까 하던 거 이어서 해"
              })
          } satisfies TaskRoutingResolver
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

  it("passes richer task contexts including latest event previews to the routing resolver", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-llm-folder",
      title: "LLM 폴더 생성",
      normalizedGoal: "LLM 폴더 생성",
      status: "completed",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:05:00.000Z",
      completionReport: {
        summary: "LLM 폴더를 만들었어요.",
        verification: "verified",
        changes: ["LLM 폴더 생성"]
      }
    });
    await taskEventRepository.saveMany("task-llm-folder", [
      {
        taskId: "task-llm-folder",
        type: "executor_completed",
        message: "Desktop/LLM 폴더 생성 완료",
        createdAt: "2026-03-08T00:05:00.000Z"
      }
    ]);

    const capturedInputs: Array<Record<string, unknown>> = [];
    const gateway = new RealtimeGatewayService(
      new FinalizedUtteranceHandler(
        new BrainTurnService(
          new ConversationOrchestrator(),
          undefined,
          undefined,
          {
            resolve: async (input) => {
              capturedInputs.push({
                utterance: input.utterance.text,
                taskContexts: input.taskContexts
              });
              return createRoutingDecision({
                kind: "create_task",
                executorPrompt: input.utterance.text
              });
            }
          } satisfies TaskRoutingResolver
        )
      ),
      taskRepository,
      taskEventRepository
    );

    await gateway.handleFinalizedUtterance({
      brainSessionId: "brain-1",
      utterance: utterance(
        "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘",
        "task_request"
      ),
      now: "2026-03-08T00:06:00.000Z"
    });

    expect(capturedInputs).toEqual([
      expect.objectContaining({
        utterance: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘",
        taskContexts: [
          expect.objectContaining({
            isActive: false,
            isRecentCompleted: true,
            latestEventPreview: "Desktop/LLM 폴더 생성 완료",
            task: expect.objectContaining({
              id: "task-llm-folder",
              title: "LLM 폴더 생성"
            })
          })
        ]
      })
    ]);
  });
});
