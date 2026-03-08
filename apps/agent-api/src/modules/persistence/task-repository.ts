import type { Task } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";

export interface TaskRepository {
  listActiveByBrainSessionId(brainSessionId: string): Promise<Task[]>;
  listRecentByBrainSessionId(
    brainSessionId: string,
    limit?: number
  ): Promise<Task[]>;
  save(brainSessionId: string, task: Task): Promise<void>;
}

interface StoredTask {
  brainSessionId: string;
  task: Task;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, StoredTask>();

  async listActiveByBrainSessionId(brainSessionId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((entry) => entry.brainSessionId === brainSessionId)
      .map((entry) => entry.task)
      .filter((task) =>
        task.status === "created" ||
        task.status === "queued" ||
        task.status === "running" ||
        task.status === "waiting_input" ||
        task.status === "approval_required"
      );
  }

  async listRecentByBrainSessionId(
    brainSessionId: string,
    limit = 5
  ): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((entry) => entry.brainSessionId === brainSessionId)
      .map((entry) => entry.task)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  async save(brainSessionId: string, task: Task): Promise<void> {
    this.tasks.set(task.id, {
      brainSessionId,
      task
    });
  }
}

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async listActiveByBrainSessionId(brainSessionId: string): Promise<Task[]> {
    const result = await this.sql.query<{
      id: string;
      title: string;
      normalized_goal: string;
      status: Task["status"];
      created_at: string;
      updated_at: string;
    }>(
      `
        select
          id,
          title,
          normalized_goal,
          status,
          created_at,
          updated_at
        from tasks
        where brain_session_id = $1
          and status in ('created', 'queued', 'running', 'waiting_input', 'approval_required')
        order by updated_at desc
      `,
      [brainSessionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      normalizedGoal: row.normalized_goal,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async listRecentByBrainSessionId(
    brainSessionId: string,
    limit = 5
  ): Promise<Task[]> {
    const result = await this.sql.query<{
      id: string;
      title: string;
      normalized_goal: string;
      status: Task["status"];
      created_at: string;
      updated_at: string;
    }>(
      `
        select
          id,
          title,
          normalized_goal,
          status,
          created_at,
          updated_at
        from tasks
        where brain_session_id = $1
        order by updated_at desc
        limit $2
      `,
      [brainSessionId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      normalizedGoal: row.normalized_goal,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async save(brainSessionId: string, task: Task): Promise<void> {
    await this.sql.query(
      `
        insert into tasks (
          id,
          brain_session_id,
          user_id,
          title,
          normalized_goal,
          status,
          created_at,
          updated_at,
          completed_at
        )
        select
          $1,
          $2,
          bs.user_id,
          $3,
          $4,
          $5,
          $6,
          $7,
          case
            when $5 in ('completed', 'failed', 'cancelled') then $7
            else null
          end
        from brain_sessions bs
        where bs.id = $2
        on conflict (id) do update
        set
          brain_session_id = excluded.brain_session_id,
          title = excluded.title,
          normalized_goal = excluded.normalized_goal,
          status = excluded.status,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `,
      [
        task.id,
        brainSessionId,
        task.title,
        task.normalizedGoal,
        task.status,
        task.createdAt,
        task.updatedAt
      ]
    );
  }
}
