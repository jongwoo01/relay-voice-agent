import type { TaskExecutorSession } from "@agent/shared-types";

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
