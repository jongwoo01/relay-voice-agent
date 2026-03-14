import type {
  ExecutorProgressListener,
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
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

      try {
        await this.sendRequest(hostedRequest);
      } catch (error) {
        this.pendingByRunId.delete(runId);
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
      throw new Error(`Unknown executor run: ${runId}`);
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
      throw new Error(`Unknown executor run: ${input.runId}`);
    }

    this.pendingByRunId.delete(input.runId);

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
      pending.reject(new Error(reason));
    }
  }
}
