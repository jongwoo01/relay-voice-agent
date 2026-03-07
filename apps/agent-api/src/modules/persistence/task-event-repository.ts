import type { TaskEvent } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";

export interface TaskEventRepository {
  listByTaskId(taskId: string): Promise<TaskEvent[]>;
  saveMany(taskId: string, events: TaskEvent[]): Promise<void>;
}

export class InMemoryTaskEventRepository implements TaskEventRepository {
  private readonly taskEvents = new Map<string, TaskEvent[]>();

  async listByTaskId(taskId: string): Promise<TaskEvent[]> {
    return this.taskEvents.get(taskId) ?? [];
  }

  async saveMany(taskId: string, events: TaskEvent[]): Promise<void> {
    const current = this.taskEvents.get(taskId) ?? [];
    this.taskEvents.set(taskId, [...current, ...events]);
  }
}

export class PostgresTaskEventRepository implements TaskEventRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async listByTaskId(taskId: string): Promise<TaskEvent[]> {
    const result = await this.sql.query<{
      task_id: string;
      type: TaskEvent["type"];
      message: string;
      created_at: string;
    }>(
      `
        select
          task_id,
          type,
          message,
          created_at
        from task_events
        where task_id = $1
        order by created_at asc
      `,
      [taskId]
    );

    return result.rows.map((row) => ({
      taskId: row.task_id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at
    }));
  }

  async saveMany(taskId: string, events: TaskEvent[]): Promise<void> {
    for (const event of events) {
      await this.sql.query(
        `
          insert into task_events (
            task_id,
            user_id,
            type,
            message,
            created_at
          )
          select
            $1,
            t.user_id,
            $2,
            $3,
            $4
          from tasks t
          where t.id = $1
        `,
        [taskId, event.type, event.message, event.createdAt]
      );
    }
  }
}
