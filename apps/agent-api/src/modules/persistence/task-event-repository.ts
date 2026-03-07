import type { TaskEvent } from "@agent/shared-types";

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
