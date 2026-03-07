import { describe, expect, it, vi } from "vitest";
import type { SqlClientLike } from "../src/index.js";
import {
  PostgresBrainSessionRepository,
  PostgresConversationMessageRepository,
  PostgresTaskEventRepository,
  PostgresTaskExecutorSessionRepository,
  PostgresTaskRepository
} from "../src/index.js";

function createSqlMock(
  rowsQueue: unknown[][] = []
): SqlClientLike & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(
    async () =>
      ({
        rows: rowsQueue.shift() ?? []
      }) as { rows: unknown[] }
  ) as unknown as ReturnType<typeof vi.fn>;

  return { query };
}

describe("postgres persistence repositories", () => {
  it("maps brain sessions from postgres rows", async () => {
    const sql = createSqlMock([
      [
        {
          id: "brain-1",
          user_id: "user-1",
          status: "active",
          source: "live",
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
          closed_at: null
        }
      ]
    ]);

    const repository = new PostgresBrainSessionRepository(sql);
    const session = await repository.getById("brain-1");

    expect(session).toEqual({
      id: "brain-1",
      userId: "user-1",
      status: "active",
      source: "live",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:00.000Z",
      closedAt: null
    });
  });

  it("persists conversation messages by deriving user_id from brain_sessions", async () => {
    const sql = createSqlMock();
    const repository = new PostgresConversationMessageRepository(sql);

    await repository.save({
      brainSessionId: "brain-1",
      speaker: "assistant",
      text: "안녕하세요",
      tone: "reply",
      createdAt: "2026-03-08T00:00:00.000Z"
    });

    expect(sql.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into conversation_messages"),
      ["brain-1", "assistant", "안녕하세요", "reply", "2026-03-08T00:00:00.000Z"]
    );
  });

  it("maps active tasks from postgres rows", async () => {
    const sql = createSqlMock([
      [
        {
          id: "task-1",
          title: "정리",
          normalized_goal: "정리",
          status: "running",
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:01:00.000Z"
        }
      ]
    ]);

    const repository = new PostgresTaskRepository(sql);
    const tasks = await repository.listActiveByBrainSessionId("brain-1");

    expect(tasks).toEqual([
      {
        id: "task-1",
        title: "정리",
        normalizedGoal: "정리",
        status: "running",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:01:00.000Z"
      }
    ]);
  });

  it("persists task events by deriving user_id from tasks", async () => {
    const sql = createSqlMock();
    const repository = new PostgresTaskEventRepository(sql);

    await repository.saveMany("task-1", [
      {
        taskId: "task-1",
        type: "executor_progress",
        message: "작업 중",
        createdAt: "2026-03-08T00:00:00.000Z"
      }
    ]);

    expect(sql.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into task_events"),
      ["task-1", "executor_progress", "작업 중", "2026-03-08T00:00:00.000Z"]
    );
  });

  it("maps executor sessions from postgres rows", async () => {
    const sql = createSqlMock([
      [
        {
          task_id: "task-1",
          session_id: "gemini-session-1",
          working_directory: "/tmp/demo",
          updated_at: "2026-03-08T00:00:00.000Z"
        }
      ]
    ]);

    const repository = new PostgresTaskExecutorSessionRepository(sql);
    const session = await repository.getByTaskId("task-1");

    expect(session).toEqual({
      taskId: "task-1",
      sessionId: "gemini-session-1",
      workingDirectory: "/tmp/demo",
      updatedAt: "2026-03-08T00:00:00.000Z"
    });
  });
});
