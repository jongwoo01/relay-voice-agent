import type {
  Task,
  TaskCompletionReport,
  TaskEvent
} from "@agent/shared-types";

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

export type ExecutorOutcome =
  | "completed"
  | "waiting_input"
  | "approval_required";

export interface ExecutorRunResult {
  progressEvents: TaskEvent[];
  completionEvent: TaskEvent;
  outcome?: ExecutorOutcome;
  sessionId?: string;
  report?: TaskCompletionReport;
}

export interface LocalExecutor {
  run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult>;
}
