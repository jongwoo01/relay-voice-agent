import type { Task, TaskEvent } from "@agent/shared-types";

export interface ExecutorRunRequest {
  task: Task;
  now: string;
  prompt: string;
  workingDirectory?: string;
  resumeSessionId?: string;
}

export interface ExecutorCompletionReport {
  summary: string;
  verification: "verified" | "uncertain";
  changes: string[];
  question?: string;
}

export type ExecutorProgressListener = (
  event: TaskEvent
) => void | Promise<void>;

export type ExecutorOutcome =
  | "completed"
  | "waiting_input"
  | "approval_required";

export interface ExecutorRunResult {
  progressEvents: TaskEvent[];
  completionEvent: TaskEvent;
  outcome?: ExecutorOutcome;
  sessionId?: string;
  report?: ExecutorCompletionReport;
}

export interface LocalExecutor {
  run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult>;
}
