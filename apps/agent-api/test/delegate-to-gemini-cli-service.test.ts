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
        text: "I'll start the task now. Progress will stay visible in the panel.",
        tone: "task_ack" as const
      },
      action: {
        type: "create_task" as const
      },
      task: {
        id: "task-1",
        title: "Desktop cleanup",
        normalizedGoal: "Desktop cleanup",
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
      request: "Clean up the desktop",
      now: "2026-03-12T00:00:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "created",
        accepted: true,
        taskId: "task-1",
        status: "running",
        message: "Task is running",
        needsInput: false,
        needsApproval: false,
        summary: undefined,
        verification: undefined,
        changes: undefined,
        presentation: {
          ownership: "runtime",
          speechMode: "canonical",
          speechText: "I started the task. I'll let you know as soon as completion or failure is confirmed.",
          allowLiveModelOutput: false
        }
      })
    );
    expect(autoHandle).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("resumes a blocked task through task execution service", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "Browser cleanup",
      normalizedGoal: "Browser cleanup",
      status: "waiting_input",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z"
    });
    const dispatch = vi.fn(async () => ({
      task: {
        id: "task-1",
        title: "Browser cleanup",
        normalizedGoal: "Browser cleanup",
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
      request: "Continue from there",
      now: "2026-03-12T00:02:00.000Z",
      taskId: "task-1",
      mode: "resume"
    });

    expect(dispatch).toHaveBeenCalledWith({
      brainSessionId: "brain-1",
      taskId: "task-1",
      text: "Continue from there",
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
      title: "Browser cleanup",
      normalizedGoal: "Browser cleanup",
      status: "completed",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:03:00.000Z",
      completionReport: {
        summary: "Verified 3 closed tabs and 2 pinned tabs.",
        verification: "verified",
        changes: ["Closed 3 tabs", "Pinned 2 tabs"]
      }
    });
    await taskEventRepository.saveMany("task-1", [
      {
        taskId: "task-1",
        type: "executor_completed",
        message: "The task is complete.",
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
      request: "What was the result of that?",
      now: "2026-03-12T00:04:00.000Z",
      taskId: "task-1",
      mode: "status"
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "status",
        accepted: true,
        taskId: "task-1",
        status: "completed",
        message: "Verified 3 closed tabs and 2 pinned tabs.",
        needsInput: false,
        needsApproval: false,
        summary: "Verified 3 closed tabs and 2 pinned tabs.",
        verification: "verified",
        changes: ["Closed 3 tabs", "Pinned 2 tabs"],
        presentation: {
          ownership: "runtime",
          speechMode: "grounded_summary",
          speechText: "Verified 3 closed tabs and 2 pinned tabs.",
          allowLiveModelOutput: false
        }
      })
    );
  });

  it("returns status when the shared loop reports a status action", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "Check desktop",
      normalizedGoal: "Check desktop",
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
        title: "Check desktop",
        normalizedGoal: "Check desktop",
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
      request: "Check the desktop",
      now: "2026-03-12T00:03:00.000Z"
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(autoHandle).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        action: "status",
        accepted: true,
        taskId: "task-1",
        status: "running",
        message: "Task is running",
        needsInput: false,
        needsApproval: false,
        summary: undefined,
        verification: undefined,
        changes: undefined,
        presentation: {
          ownership: "runtime",
          speechMode: "canonical",
          speechText:
            "The task is still running. I'll let you know as soon as completion or failure is confirmed.",
          allowLiveModelOutput: false
        }
      })
    );
  });

  it("creates a new task when one running task exists but the request is unrelated", async () => {
    const taskRepository = new InMemoryTaskRepository();
    const taskEventRepository = new InMemoryTaskEventRepository();
    await taskRepository.save("brain-1", {
      id: "task-1",
      title: "Check desktop",
      normalizedGoal: "Check desktop",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:02:00.000Z"
    });
    const dispatch = vi.fn();
    const autoHandle = vi.fn(async () => ({
      assistant: {
        text: "I'll start organizing the downloads.",
        tone: "task_ack" as const
      },
      action: {
        type: "create_task" as const
      },
      task: {
        id: "task-2",
        title: "Download cleanup",
        normalizedGoal: "Download cleanup",
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
      request: "Clean up the downloads folder",
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
      title: "Browser cleanup",
      normalizedGoal: "Browser cleanup",
      status: "running",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z"
    });
    await taskRepository.save("brain-1", {
      id: "task-2",
      title: "Download cleanup",
      normalizedGoal: "Download cleanup",
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
          text: "There are multiple active tasks, so tell me which one you mean first.",
          tone: "clarify" as const
        },
        action: {
          type: "clarify" as const
        }
      }))
    );

    const result = await service.handle({
      brainSessionId: "brain-1",
      request: "How far along is that?",
      now: "2026-03-12T00:03:00.000Z",
      mode: "status"
    });

    expect(result.accepted).toBe(false);
    expect(result.action).toBe("clarify");
    expect(result.message).toContain("multiple active tasks");
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
          text: "Task routing failed because the Vertex AI quota was exhausted.",
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
      request: "Tell me the desktop file names",
      now: "2026-03-12T00:03:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "error",
        accepted: false,
        status: "failed",
        message: "Task routing failed because the Vertex AI quota was exhausted.",
        failureReason: "quota_exhausted",
        needsInput: false,
        needsApproval: false,
        summary: undefined,
        verification: undefined,
        changes: undefined,
        presentation: {
          ownership: "runtime",
          speechMode: "canonical",
          speechText: "Task routing failed because the Vertex AI quota was exhausted.",
          allowLiveModelOutput: false
        }
      })
    );
  });
});
