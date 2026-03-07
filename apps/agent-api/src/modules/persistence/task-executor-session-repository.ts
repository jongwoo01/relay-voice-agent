import type { TaskExecutorSession } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";

export interface TaskExecutorSessionRepository {
  getByTaskId(taskId: string): Promise<TaskExecutorSession | null>;
  save(session: TaskExecutorSession): Promise<void>;
}

export class InMemoryTaskExecutorSessionRepository
  implements TaskExecutorSessionRepository
{
  private readonly sessions = new Map<string, TaskExecutorSession>();

  async getByTaskId(taskId: string): Promise<TaskExecutorSession | null> {
    return this.sessions.get(taskId) ?? null;
  }

  async save(session: TaskExecutorSession): Promise<void> {
    this.sessions.set(session.taskId, session);
  }
}

export class PostgresTaskExecutorSessionRepository
  implements TaskExecutorSessionRepository
{
  constructor(private readonly sql: SqlClientLike) {}

  async getByTaskId(taskId: string): Promise<TaskExecutorSession | null> {
    const result = await this.sql.query<{
      task_id: string;
      session_id: string | null;
      working_directory: string | null;
      updated_at: string;
    }>(
      `
        select
          task_id,
          session_id,
          working_directory,
          updated_at
        from task_executor_sessions
        where task_id = $1
      `,
      [taskId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      taskId: row.task_id,
      sessionId: row.session_id ?? undefined,
      workingDirectory: row.working_directory ?? undefined,
      updatedAt: row.updated_at
    };
  }

  async save(session: TaskExecutorSession): Promise<void> {
    await this.sql.query(
      `
        insert into task_executor_sessions (
          task_id,
          user_id,
          executor_type,
          session_id,
          working_directory,
          updated_at,
          last_heartbeat_at
        )
        select
          $1,
          t.user_id,
          'gemini_cli',
          $2,
          $3,
          $4,
          $4
        from tasks t
        where t.id = $1
        on conflict (task_id) do update
        set
          session_id = excluded.session_id,
          working_directory = excluded.working_directory,
          updated_at = excluded.updated_at,
          last_heartbeat_at = excluded.last_heartbeat_at
      `,
      [
        session.taskId,
        session.sessionId ?? null,
        session.workingDirectory ?? null,
        session.updatedAt
      ]
    );
  }
}
