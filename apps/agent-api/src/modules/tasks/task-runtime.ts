import { completeTask, createTask, queueTask, reportTaskProgress } from "@agent/brain-domain";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { Task, TaskEvent, TaskExecutorSession } from "@agent/shared-types";
import { MockExecutor } from "../executor/mock-executor.js";
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
}

export interface PreparedTaskRun {
  task: Task;
  initialEvents: TaskEvent[];
  request: ExecutorRunRequest;
  priorExecutorSession?: TaskExecutorSession;
}

export class TaskRuntime {
  constructor(private readonly executor: LocalExecutor = new MockExecutor()) {}

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
          workingDirectory: input.executorSession?.workingDirectory
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
        workingDirectory: input.executorSession?.workingDirectory
      },
      priorExecutorSession: input.executorSession
    };
  }

  async runPrepared(prepared: PreparedTaskRun): Promise<TaskRunResult> {
    const execution = await this.executor.run(prepared.request);
    return this.applyExecutionResult(prepared, execution);
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
    events.push(completed.event);

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
      task: completed.task,
      events,
      executorSession: nextExecutorSession
    };
  }

  async submit(input: TaskRunInput): Promise<TaskRunResult> {
    const prepared = this.prepare(input);
    const result = await this.runPrepared(prepared);

    return {
      task: result.task,
      events: [...prepared.initialEvents, ...result.events],
      executorSession: result.executorSession
    };
  }
}
