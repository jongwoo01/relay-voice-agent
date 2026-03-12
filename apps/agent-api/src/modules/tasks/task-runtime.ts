import { homedir } from "node:os";
import {
  completeTask,
  createTask,
  failTask,
  pauseTaskForApproval,
  pauseTaskForInput,
  queueTask,
  reportTaskProgress
} from "@agent/brain-domain";
import { MockExecutor } from "@agent/gemini-cli-runner";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  ExecutorProgressListener,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type {
  Task,
  TaskCompletionReport,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import { startTask } from "@agent/brain-domain";

export interface TaskRunInput {
  text: string;
  taskId: string;
  now: string;
  executorSession?: TaskExecutorSession;
  existingTask?: Task;
}

export interface TaskRunResult {
  task: Task;
  events: TaskEvent[];
  executorSession?: TaskExecutorSession;
  report?: TaskCompletionReport;
}

export interface PreparedTaskRun {
  task: Task;
  initialEvents: TaskEvent[];
  request: ExecutorRunRequest;
  priorExecutorSession?: TaskExecutorSession;
}

export class TaskRuntime {
  private readonly defaultWorkingDirectory: string;

  constructor(
    private readonly executor: LocalExecutor = new MockExecutor(),
    defaultWorkingDirectory: string = homedir()
  ) {
    this.defaultWorkingDirectory = defaultWorkingDirectory;
  }

  private resolveWorkingDirectory(
    executorSession?: TaskExecutorSession
  ): string {
    return executorSession?.workingDirectory ?? this.defaultWorkingDirectory;
  }

  prepare(input: TaskRunInput): PreparedTaskRun {
    if (input.existingTask) {
      const started = startTask(
        input.existingTask,
        input.now,
        "Task is running"
      );

      return {
        task: started.task,
        initialEvents: [started.event],
        request: {
          task: started.task,
          now: input.now,
          prompt: input.text,
          resumeSessionId: input.executorSession?.sessionId,
          workingDirectory: this.resolveWorkingDirectory(input.executorSession)
        },
        priorExecutorSession: input.executorSession
      };
    }

    const created = createTask(input.text, input.now, input.taskId);
    const queued = queueTask(created.task, input.now);
    const started = startTask(queued.task, input.now, "Task is running");

    return {
      task: started.task,
      initialEvents: [created.event, queued.event, started.event],
      request: {
        task: started.task,
        now: input.now,
        prompt: input.text,
        resumeSessionId: input.executorSession?.sessionId,
        workingDirectory: this.resolveWorkingDirectory(input.executorSession)
      },
      priorExecutorSession: input.executorSession
    };
  }

  async runPrepared(
    prepared: PreparedTaskRun,
    onProgress?: ExecutorProgressListener
  ): Promise<TaskRunResult> {
    try {
      const execution = await this.executor.run(prepared.request, onProgress);
      return this.applyExecutionResult(prepared, execution);
    } catch (error) {
      return this.applyExecutionFailure(prepared, error);
    }
  }

  applyExecutionResult(
    prepared: PreparedTaskRun,
    execution: ExecutorRunResult
  ): TaskRunResult {
    let currentTask = prepared.task;
    const events: TaskEvent[] = [];

    for (const progressEvent of execution.progressEvents) {
      const progress = reportTaskProgress(
        currentTask,
        progressEvent.createdAt,
        progressEvent.message
      );
      currentTask = progress.task;
      events.push(progress.event);
    }

    const completed = completeTask(
      currentTask,
      execution.completionEvent.createdAt,
      execution.completionEvent.message
    );
    const waitingInput = pauseTaskForInput(
      currentTask,
      execution.completionEvent.createdAt,
      execution.completionEvent.message
    );
    const approvalRequired = pauseTaskForApproval(
      currentTask,
      execution.completionEvent.createdAt,
      execution.completionEvent.message
    );

    const terminalTransition =
      execution.outcome === "waiting_input"
        ? waitingInput
        : execution.outcome === "approval_required"
          ? approvalRequired
          : completed;
    currentTask =
      execution.report && terminalTransition.task.status === "completed"
        ? {
            ...terminalTransition.task,
            completionReport: execution.report
          }
        : terminalTransition.task;
    events.push(terminalTransition.event);

    const nextExecutorSession =
      execution.sessionId || prepared.priorExecutorSession
        ? {
            taskId: prepared.request.task.id,
            sessionId:
              execution.sessionId ?? prepared.priorExecutorSession?.sessionId,
            workingDirectory: prepared.request.workingDirectory,
            updatedAt: prepared.request.now
          }
        : undefined;

    return {
      task: currentTask,
      events,
      executorSession: nextExecutorSession,
      report: execution.report
    };
  }

  applyExecutionFailure(
    prepared: PreparedTaskRun,
    error: unknown
  ): TaskRunResult {
    const failed = failTask(
      prepared.task,
      prepared.request.now,
      error instanceof Error ? error.message : "Task execution failed"
    );

    return {
      task: failed.task,
      events: [failed.event],
      executorSession: prepared.priorExecutorSession
    };
  }

  async submit(input: TaskRunInput): Promise<TaskRunResult> {
    const prepared = this.prepare(input);
    const result = await this.runPrepared(prepared);

    return {
      task:
        result.report && result.task.status === "completed"
          ? {
              ...result.task,
              completionReport: result.report
            }
          : result.task,
      events: [...prepared.initialEvents, ...result.events],
      executorSession: result.executorSession,
      report: result.report
    };
  }
}
