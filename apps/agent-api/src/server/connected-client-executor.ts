import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { ExecutorCancelledError } from "@agent/gemini-cli-runner";
import type { TaskEvent } from "@agent/shared-types";
import type { HostedExecutorRequest } from "./protocol.js";

interface PendingExecution {
  request: HostedExecutorRequest;
  progressEvents: TaskEvent[];
  onProgress?: ExecutorProgressListener;
  resolve: (result: ExecutorRunResult) => void;
  reject: (error: Error) => void;
}

export class ConnectedClientExecutor implements LocalExecutor {
  private readonly pendingByRunId = new Map<string, PendingExecution>();
  private readonly runIdByTaskId = new Map<string, string>();

  constructor(
    private readonly sendRequest: (request: HostedExecutorRequest) => Promise<void>
  ) {}

  async run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    const runId = `run-${crypto.randomUUID()}`;
    const hostedRequest: HostedExecutorRequest = {
      runId,
      taskId: request.task.id,
      request
    };

    return await new Promise<ExecutorRunResult>(async (resolve, reject) => {
      this.pendingByRunId.set(runId, {
        request: hostedRequest,
        progressEvents: [],
        onProgress,
        resolve,
        reject
      });
      this.runIdByTaskId.set(request.task.id, runId);

      try {
        await this.sendRequest(hostedRequest);
      } catch (error) {
        this.pendingByRunId.delete(runId);
        this.runIdByTaskId.delete(request.task.id);
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to send executor request to connected client")
        );
      }
    });
  }

  async recordProgress(runId: string, event: TaskEvent): Promise<void> {
    const pending = this.pendingByRunId.get(runId);
    if (!pending) {
      return;
    }

    pending.progressEvents.push(event);
    await pending.onProgress?.(event);
  }

  completeRun(input: {
    runId: string;
    ok: boolean;
    result?: ExecutorRunResult;
    error?: string;
  }): void {
    const pending = this.pendingByRunId.get(input.runId);
    if (!pending) {
      return;
    }

    this.pendingByRunId.delete(input.runId);
    this.runIdByTaskId.delete(pending.request.taskId);

    if (!input.ok) {
      pending.reject(new Error(input.error || "Connected executor failed"));
      return;
    }

    if (!input.result) {
      pending.reject(new Error("Connected executor did not return a result"));
      return;
    }

    pending.resolve({
      ...input.result,
      progressEvents:
        input.result.progressEvents?.length > 0
          ? input.result.progressEvents
          : pending.progressEvents
    });
  }

  failAll(reason: string): void {
    for (const [runId, pending] of this.pendingByRunId.entries()) {
      this.pendingByRunId.delete(runId);
      this.runIdByTaskId.delete(pending.request.taskId);
      pending.reject(new Error(reason));
    }
  }

  async cancel(taskId: string): Promise<boolean> {
    const runId = this.runIdByTaskId.get(taskId);
    if (!runId) {
      return false;
    }

    const pending = this.pendingByRunId.get(runId);
    this.runIdByTaskId.delete(taskId);
    this.pendingByRunId.delete(runId);
    pending?.reject(new ExecutorCancelledError(`Task ${taskId} execution cancelled`));
    return Boolean(pending);
  }
}
