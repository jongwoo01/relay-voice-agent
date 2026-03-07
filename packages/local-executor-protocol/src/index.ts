import type { Task, TaskEvent } from "@agent/shared-types";

export interface ExecutorRunRequest {
  task: Task;
  now: string;
  prompt: string;
  workingDirectory?: string;
  resumeSessionId?: string;
}

export interface ExecutorRunResult {
  progressEvents: TaskEvent[];
  completionEvent: TaskEvent;
  sessionId?: string;
}

export interface LocalExecutor {
  run(request: ExecutorRunRequest): Promise<ExecutorRunResult>;
}
