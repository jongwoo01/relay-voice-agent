import type {
  Task,
  TaskCompletionReport,
  TaskExecutionArtifact,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import {
  InMemoryTaskEventRepository,
  type TaskEventRepository
} from "../persistence/task-event-repository.js";
import {
  InMemoryTaskExecutionArtifactRepository,
  type TaskExecutionArtifactRepository
} from "../persistence/task-execution-artifact-repository.js";
import {
  InMemoryTaskRepository,
  type TaskRepository
} from "../persistence/task-repository.js";
import {
  InMemoryTaskExecutorSessionRepository,
  type TaskExecutorSessionRepository
} from "../persistence/task-executor-session-repository.js";
import { TaskRuntime } from "./task-runtime.js";

export interface ExecuteTaskInput {
  brainSessionId?: string;
  taskId: string;
  text: string;
  now: string;
  existingTask?: Task;
}

export interface ExecuteTaskResult {
  task: Task;
  events: TaskEvent[];
  executorSession?: TaskExecutorSession;
  report?: TaskCompletionReport;
  artifacts: TaskExecutionArtifact[];
}

export interface TaskTerminalNotification {
  brainSessionId: string;
  task: Task;
  terminalEvent: TaskEvent;
  executorSession?: TaskExecutorSession;
}

export type TaskTerminalNotifier = (
  notification: TaskTerminalNotification
) => void | Promise<void>;

export class TaskExecutionService {
  private readonly inFlightExecutions = new Set<Promise<void>>();

  constructor(
    private readonly runtime: TaskRuntime = new TaskRuntime(),
    private readonly sessionRepository: TaskExecutorSessionRepository = new InMemoryTaskExecutorSessionRepository(),
    private readonly taskRepository: TaskRepository = new InMemoryTaskRepository(),
    private readonly taskEventRepository: TaskEventRepository = new InMemoryTaskEventRepository(),
    private readonly notifyTerminalState?: TaskTerminalNotifier,
    private readonly taskExecutionArtifactRepository: TaskExecutionArtifactRepository = new InMemoryTaskExecutionArtifactRepository()
  ) {}

  async execute(input: ExecuteTaskInput): Promise<ExecuteTaskResult> {
    const existingSession = await this.sessionRepository.getByTaskId(input.taskId);

    const result = await this.runtime.submit({
      text: input.text,
      taskId: input.taskId,
      now: input.now,
      executorSession: existingSession ?? undefined,
      existingTask: input.existingTask
    });

    if (input.brainSessionId) {
      await this.taskRepository.save(input.brainSessionId, result.task);
    }
    await this.taskEventRepository.saveMany(input.taskId, result.events);
    if (result.artifacts.length > 0) {
      await this.taskExecutionArtifactRepository.saveMany(input.taskId, result.artifacts);
    }

    if (result.executorSession) {
      await this.sessionRepository.save(result.executorSession);
    }

    return result;
  }

  async dispatch(input: ExecuteTaskInput): Promise<ExecuteTaskResult> {
    if (!input.brainSessionId) {
      throw new Error("brainSessionId is required for dispatch");
    }

    const existingSession = await this.sessionRepository.getByTaskId(input.taskId);
    const prepared = this.runtime.prepare({
      text: input.text,
      taskId: input.taskId,
      now: input.now,
      executorSession: existingSession ?? undefined,
      existingTask: input.existingTask
    });

    await this.taskRepository.save(input.brainSessionId, prepared.task);
    await this.taskEventRepository.saveMany(input.taskId, prepared.initialEvents);

    const execution = this.runtime
      .runPrepared(prepared, async (progressEvent) => {
        await this.taskEventRepository.saveMany(input.taskId, [progressEvent]);
      })
      .then(async (result) => {
        const currentTask = await this.taskRepository.getById(input.taskId);
        const isAlreadyCancelled =
          result.task.status === "cancelled" && currentTask?.status === "cancelled";

        if (!isAlreadyCancelled) {
          await this.taskRepository.save(input.brainSessionId!, result.task);
          await this.taskEventRepository.saveMany(
            input.taskId,
            result.events.filter((event) => event.type !== "executor_progress")
          );
        }
        if (result.artifacts.length > 0) {
          await this.taskExecutionArtifactRepository.saveMany(input.taskId, result.artifacts);
        }

        if (result.executorSession) {
          await this.sessionRepository.save(result.executorSession);
        } else if (result.task.status === "cancelled") {
          await this.sessionRepository.deleteByTaskId(input.taskId);
        }

        const terminalEvent = [...result.events]
          .reverse()
          .find(
            (event) =>
              event.type === "executor_waiting_input" ||
              event.type === "executor_approval_required" ||
              event.type === "executor_completed" ||
              event.type === "executor_failed" ||
              event.type === "executor_cancelled"
          );

        if (terminalEvent && this.notifyTerminalState) {
          await this.notifyTerminalState({
            brainSessionId: input.brainSessionId!,
            task: result.task,
            terminalEvent,
            executorSession: result.executorSession
          });
        }
      })
      .finally(() => {
        this.inFlightExecutions.delete(execution);
      });

    this.inFlightExecutions.add(execution);

    return {
      task: prepared.task,
      events: prepared.initialEvents,
      executorSession: prepared.priorExecutorSession,
      report: undefined,
      artifacts: []
    };
  }

  async waitForAll(): Promise<void> {
    await Promise.all([...this.inFlightExecutions]);
  }
}
