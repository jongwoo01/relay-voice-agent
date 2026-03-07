import type {
  AssistantEnvelope,
  FinalizedUtterance,
  Task,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import { FinalizedUtteranceHandler } from "./finalized-utterance-handler.js";
import {
  InMemoryTaskRepository,
  type TaskRepository
} from "../persistence/task-repository.js";

export interface RealtimeGatewayInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  now: string;
}

export interface RealtimeGatewayResult {
  assistant: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export class RealtimeGatewayService {
  constructor(
    private readonly handler: FinalizedUtteranceHandler = new FinalizedUtteranceHandler(),
    private readonly taskRepository: TaskRepository = new InMemoryTaskRepository()
  ) {}

  async handleFinalizedUtterance(
    input: RealtimeGatewayInput
  ): Promise<RealtimeGatewayResult> {
    const activeTasks = await this.taskRepository.listActiveByBrainSessionId(
      input.brainSessionId
    );

    const result = await this.handler.handle({
      brainSessionId: input.brainSessionId,
      utterance: input.utterance,
      activeTasks,
      now: input.now
    });

    if (result.task) {
      await this.taskRepository.save(input.brainSessionId, result.task);
    }

    return result;
  }
}
