import type { Task, TaskEvent } from "@agent/shared-types";

export interface ExecutorRunRequest {
  task: Task;
  now: string;
  prompt: string;
  workingDirectory?: string;
  resumeSessionId?: string;
}

export type ExecutorProgressListener = (
  event: TaskEvent
) => void | Promise<void>;

export interface ExecutorRunResult {
  progressEvents: TaskEvent[];
  completionEvent: TaskEvent;
  sessionId?: string;
}

export interface LocalExecutor {
  run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult>;
}
