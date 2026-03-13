import { describe, expect, it, vi } from "vitest";
import {
  DelegateToGeminiCliService,
  InMemoryTaskEventRepository,
  InMemoryTaskRepository
} from "../src/index.js";

describe("delegate-to-gemini-cli-service", () => {
  it("creates a new task through the auto handler", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    const dispatch = vi.fn();
    const autoHandle = vi.fn(async () => ({
      assistant: {
        text: "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
        tone: "task_ack" as const
      },
      action: {
        type: "create_task" as const
      },
      task: {
        id: "task-1",
        title: "바탕화면 정리",
        normalizedGoal: "바탕화면 정리",
        status: "running" as const,
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z"
      },
      taskEvents: [
        {
          taskId: "task-1",
          type: "task_started" as const,
          message: "Task is running",
          createdAt: "2026-03-12T00:00:00.000Z"
        }
      ]
    }));
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch } as never,
      autoHandle
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "바탕화면 정리해줘",
      now: "2026-03-12T00:00:00.000Z"
    });

    expect(result).toEqual({
      action: "created",
      accepted: true,
      taskId: "task-1",
      status: "running",
      message: "Task is running",
      needsInput: false,
      needsApproval: false,
      summary: undefined,
      verification: undefined,
      changes: undefined
    });
    expect(autoHandle).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("resumes a blocked task through task execution service", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "브라우저 정리",
      normalizedGoal: "브라우저 정리",
      status: "waiting_input",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z"
    });
    const dispatch = vi.fn(async () => ({
      task: {
        id: "task-1",
        title: "브라우저 정리",
        normalizedGoal: "브라우저 정리",
        status: "running",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:02:00.000Z"
      },
      events: [
        {
          taskId: "task-1",
          type: "task_started",
          message: "Task is running",
          createdAt: "2026-03-12T00:02:00.000Z"
        }
      ]
    }));
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch } as never,
      vi.fn()
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "이어서 진행해줘",
      now: "2026-03-12T00:02:00.000Z",
      taskId: "task-1",
      mode: "resume"
    });

    expect(dispatch).toHaveBeenCalledWith({
      brainSessionId: "brain-1",
      taskId: "task-1",
      text: "이어서 진행해줘",
      now: "2026-03-12T00:02:00.000Z",
      existingTask: expect.objectContaining({
        id: "task-1",
        status: "waiting_input"
      })
    });
    expect(result.action).toBe("resumed");
    expect(result.accepted).toBe(true);
    expect(result.status).toBe("running");
  });

  it("returns stored status and completion report without re-running the executor", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "브라우저 정리",
      normalizedGoal: "브라우저 정리",
      status: "completed",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:03:00.000Z",
      completionReport: {
        summary: "닫은 탭 3개와 고정한 탭 2개를 확인했어요.",
        verification: "verified",
        changes: ["닫은 탭 3개", "고정한 탭 2개"]
      }
    });
    await taskEventRepository.saveMany("task-1", [
      {
        taskId: "task-1",
        type: "executor_completed",
        message: "작업이 완료됐어요.",
        createdAt: "2026-03-12T00:03:00.000Z"
      }
    ]);
    const dispatch = vi.fn();
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch } as never,
      vi.fn()
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "그거 결과가 뭐야?",
      now: "2026-03-12T00:04:00.000Z",
      taskId: "task-1",
      mode: "status"
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result).toEqual({
      action: "status",
      accepted: true,
      taskId: "task-1",
      status: "completed",
      message: "닫은 탭 3개와 고정한 탭 2개를 확인했어요.",
      needsInput: false,
      needsApproval: false,
      summary: "닫은 탭 3개와 고정한 탭 2개를 확인했어요.",
      verification: "verified",
      changes: ["닫은 탭 3개", "고정한 탭 2개"]
    });
  });

  it("returns status when the shared loop reports a status action", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "바탕화면 확인",
      normalizedGoal: "바탕화면 확인",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:02:00.000Z"
    });
    await taskEventRepository.saveMany("task-1", [
      {
        taskId: "task-1",
        type: "task_started",
        message: "Task is running",
        createdAt: "2026-03-12T00:02:00.000Z"
      }
    ]);
    const dispatch = vi.fn();
    const autoHandle = vi.fn(async () => ({
      assistant: {
        text: "Task is running",
        tone: "reply" as const
      },
      action: {
        type: "status" as const,
        taskId: "task-1"
      },
      task: {
        id: "task-1",
        title: "바탕화면 확인",
        normalizedGoal: "바탕화면 확인",
        status: "running" as const,
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:02:00.000Z"
      }
    }));
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch } as never,
      autoHandle
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "바탕화면 확인해줘",
      now: "2026-03-12T00:03:00.000Z"
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(autoHandle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      action: "status",
      accepted: true,
      taskId: "task-1",
      status: "running",
      message: "Task is running",
      needsInput: false,
      needsApproval: false,
      summary: undefined,
      verification: undefined,
      changes: undefined
    });
  });

  it("creates a new task when one running task exists but the request is unrelated", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "바탕화면 확인",
      normalizedGoal: "바탕화면 확인",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:02:00.000Z"
    });
    const dispatch = vi.fn();
    const autoHandle = vi.fn(async () => ({
      assistant: {
        text: "다운로드 정리를 시작할게.",
        tone: "task_ack" as const
      },
      action: {
        type: "create_task" as const
      },
      task: {
        id: "task-2",
        title: "다운로드 정리",
        normalizedGoal: "다운로드 정리",
        status: "running" as const,
        createdAt: "2026-03-12T00:03:00.000Z",
        updatedAt: "2026-03-12T00:03:00.000Z"
      },
      taskEvents: [
        {
          taskId: "task-2",
          type: "task_started" as const,
          message: "Task is running",
          createdAt: "2026-03-12T00:03:00.000Z"
        }
      ]
    }));
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch } as never,
      autoHandle
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "다운로드 폴더 정리해줘",
      now: "2026-03-12T00:03:00.000Z"
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(autoHandle).toHaveBeenCalled();
    expect(result.action).toBe("created");
    expect(result.taskId).toBe("task-2");
  });

  it("clarifies when multiple active tasks exist and no task id is provided", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "브라우저 정리",
      normalizedGoal: "브라우저 정리",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z"
    });
    await taskRepository.save("brain-1", {
      id: "task-2",
      title: "다운로드 정리",
      normalizedGoal: "다운로드 정리",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:02:00.000Z"
    });
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch: vi.fn() } as never,
      vi.fn(async () => ({
        assistant: {
          text: "진행 중인 작업이 여러 개라서 어떤 작업인지 먼저 집어줘.",
          tone: "clarify" as const
        },
        action: {
          type: "clarify" as const
        }
      }))
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "그거 어디까지 했어?",
      now: "2026-03-12T00:03:00.000Z",
      mode: "status"
    });

    expect(result.accepted).toBe(false);
    expect(result.action).toBe("clarify");
    expect(result.message).toContain("여러 개");
  });

  it("surfaces explicit Vertex routing failures instead of clarify", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    const service = new DelegateToGeminiCliService(
      taskRepository,
      taskEventRepository,
      { dispatch: vi.fn() } as never,
      vi.fn(async () => ({
        assistant: {
          text: "Vertex AI quota 제한으로 작업 라우팅이 실패했습니다.",
          tone: "reply" as const
        },
        action: {
          type: "error" as const,
          reason: "quota_exhausted" as const
        }
      }))
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "바탕화면 파일 이름 알려줘",
      now: "2026-03-12T00:03:00.000Z"
    });

    expect(result).toEqual({
      action: "error",
      accepted: false,
      status: "failed",
      message: "Vertex AI quota 제한으로 작업 라우팅이 실패했습니다.",
      failureReason: "quota_exhausted",
      needsInput: false,
      needsApproval: false,
      summary: undefined,
      verification: undefined,
      changes: undefined
    });
  });
});
