import type {
  AssistantEnvelope,
  FinalizedUtterance,
  NextAction,
  Task,
  TaskRoutingTaskContext,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import { FinalizedUtteranceHandler } from "./finalized-utterance-handler.js";
import type { TaskRoutingDecision } from "../conversation/task-routing-resolver.js";
import {
  InMemoryTaskRepository,
  type TaskRepository
} from "../persistence/task-repository.js";
import {
  InMemoryTaskEventRepository,
  type TaskEventRepository
} from "../persistence/task-event-repository.js";

export interface RealtimeGatewayInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  now: string;
}

export interface RealtimeGatewayResult {
  assistant: AssistantEnvelope;
  action?: NextAction;
  routingDecision?: TaskRoutingDecision;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export class RealtimeGatewayService {
  constructor(
    private readonly handler: FinalizedUtteranceHandler = new FinalizedUtteranceHandler(),
    private readonly taskRepository: TaskRepository = new InMemoryTaskRepository(),
    private readonly taskEventRepository: TaskEventRepository = new InMemoryTaskEventRepository()
  ) {}

  private async buildTaskContexts(
    activeTasks: Task[],
    recentTasks: Task[]
  ): Promise<TaskRoutingTaskContext[]> {
    const uniqueTasks = [...activeTasks, ...recentTasks].filter(
      (task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index
    );

    const contexts = await Promise.all(
      uniqueTasks.map(async (task) => {
        const events = await this.taskEventRepository.listByTaskId(task.id);
        const latestEvent = events.at(-1);
        return {
          task,
          isActive: activeTasks.some((candidate) => candidate.id === task.id),
          isRecentCompleted:
            !activeTasks.some((candidate) => candidate.id === task.id) &&
            recentTasks.some((candidate) => candidate.id === task.id) &&
            (task.status === "completed" ||
              task.status === "failed" ||
              task.status === "cancelled"),
          latestEventPreview: latestEvent?.message
        } satisfies TaskRoutingTaskContext;
      })
    );

    return contexts;
  }

  async handleFinalizedUtterance(
    input: RealtimeGatewayInput
  ): Promise<RealtimeGatewayResult> {
    const [activeTasks, recentTasks] = await Promise.all([
      this.taskRepository.listActiveByBrainSessionId(input.brainSessionId),
      this.taskRepository.listRecentByBrainSessionId(input.brainSessionId, 8)
    ]);
    const taskContexts = await this.buildTaskContexts(activeTasks, recentTasks);

    const result = await this.handler.handle({
      brainSessionId: input.brainSessionId,
      utterance: input.utterance,
      activeTasks,
      recentTasks,
      taskContexts,
      now: input.now
    });

    if (result.task) {
      await this.taskRepository.save(input.brainSessionId, result.task);
    }

    return result;
  }
}
