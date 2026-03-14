import { describe, expect, it, vi } from "vitest";
import type { SqlClientLike } from "../src/index.js";
import {
  PostgresBrainSessionRepository,
  PostgresConversationMessageRepository,
  PostgresTaskEventRepository,
  PostgresTaskExecutorSessionRepository,
  PostgresTaskRepository
} from "../src/index.js";
import { createPostgresPool } from "../src/modules/persistence/postgres-client.js";
import { loadDotEnvFromRoot } from "../src/modules/config/env-loader.js";

loadDotEnvFromRoot(process.cwd());

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
          updated_at: "2026-03-08T00:01:00.000Z",
          completion_report_json: null
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
        updatedAt: "2026-03-08T00:01:00.000Z",
        completionReport: undefined
      }
    ]);
  });

  it("maps a task by id with its completion report", async () => {
    const sql = createSqlMock([
      [
        {
          id: "task-1",
          title: "정리",
          normalized_goal: "정리",
          status: "completed",
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:01:00.000Z",
          completion_report_json: {
            summary: "정리 완료",
            verification: "verified",
            changes: ["파일 2개 정리"]
          }
        }
      ]
    ]);

    const repository = new PostgresTaskRepository(sql);
    const task = await repository.getById("task-1");

    expect(task).toEqual({
      id: "task-1",
      title: "정리",
      normalizedGoal: "정리",
      status: "completed",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:01:00.000Z",
      completionReport: {
        summary: "정리 완료",
        verification: "verified",
        changes: ["파일 2개 정리"]
      }
    });
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

  it("persists completion reports with tasks", async () => {
    const sql = createSqlMock();
    const repository = new PostgresTaskRepository(sql);

    await repository.save("brain-1", {
      id: "task-1",
      title: "정리",
      normalizedGoal: "정리",
      status: "completed",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:01:00.000Z",
      completionReport: {
        summary: "정리 완료",
        verification: "verified",
        changes: ["파일 2개 정리"]
      }
    });

    expect(sql.query).toHaveBeenCalledWith(
      expect.stringContaining("completion_report_json"),
      [
        "task-1",
        "brain-1",
        "정리",
        "정리",
        "completed",
        "2026-03-08T00:00:00.000Z",
        "2026-03-08T00:01:00.000Z",
        JSON.stringify({
          summary: "정리 완료",
          verification: "verified",
          changes: ["파일 2개 정리"]
        })
      ]
    );
  });
});

const describeWithDatabase = process.env.DATABASE_URL?.trim()
  ? describe
  : describe.skip;

describeWithDatabase("postgres persistence repositories (real db)", () => {
  it("saves running tasks without timestamp parameter type conflicts", async () => {
    const sql = createPostgresPool();
    const repository = new PostgresTaskRepository(sql);
    const userId = crypto.randomUUID();
    const brainSessionId = `brain-${crypto.randomUUID()}`;
    const taskId = `task-${crypto.randomUUID()}`;
    const now = "2026-03-14T00:00:00.000Z";

    try {
      await sql.query(
        `
          insert into users (id, email, display_name, created_at, updated_at)
          values ($1, $2, $3, $4::timestamptz, $4::timestamptz)
        `,
        [userId, `${userId}@example.test`, "Test User", now]
      );
      await sql.query(
        `
          insert into brain_sessions (id, user_id, status, source, created_at, updated_at)
          values ($1, $2, 'active', 'desktop', $3::timestamptz, $3::timestamptz)
        `,
        [brainSessionId, userId, now]
      );

      await repository.save(brainSessionId, {
        id: taskId,
        title: "바탕화면 읽기",
        normalizedGoal: "바탕화면 읽기",
        status: "running",
        createdAt: now,
        updatedAt: now
      });

      await expect(repository.getById(taskId)).resolves.toEqual({
        id: taskId,
        title: "바탕화면 읽기",
        normalizedGoal: "바탕화면 읽기",
        status: "running",
        createdAt: now,
        updatedAt: now,
        completionReport: undefined
      });
    } finally {
      await sql.query("delete from tasks where id = $1", [taskId]);
      await sql.query("delete from brain_sessions where id = $1", [brainSessionId]);
      await sql.query("delete from users where id = $1", [userId]);
      await sql.end();
    }
  });
});
