import type { Task } from "@agent/shared-types";

export interface TaskRepository {
  listActiveByBrainSessionId(brainSessionId: string): Promise<Task[]>;
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
        task.status === "waiting_input"
      );
  }

  async save(brainSessionId: string, task: Task): Promise<void> {
    this.tasks.set(task.id, {
      brainSessionId,
      task
    });
  }
}
