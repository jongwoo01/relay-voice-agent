import type {
  ConversationMessage,
  FinalizedUtterance,
  Task,
  TaskEvent
} from "@agent/shared-types";
import type { LocalExecutor } from "@agent/local-executor-protocol";
import { ConversationOrchestrator } from "../conversation/conversation-orchestrator.js";
import { BrainTurnService } from "../conversation/brain-turn-service.js";
import { MockExecutor } from "../executor/mock-executor.js";
import {
  type ConversationMessageRepository
} from "../persistence/conversation-message-repository.js";
import { type TaskEventRepository } from "../persistence/task-event-repository.js";
import { type TaskExecutorSessionRepository } from "../persistence/task-executor-session-repository.js";
import { type TaskRepository } from "../persistence/task-repository.js";
import {
  FinalizedUtteranceHandler,
  type FinalizedUtteranceHandled
} from "./finalized-utterance-handler.js";
import { RealtimeGatewayService } from "./realtime-gateway-service.js";
import { TaskExecutionService } from "../tasks/task-execution-service.js";
import { TaskRuntime } from "../tasks/task-runtime.js";
import {
  createInMemorySessionPersistence,
  type SessionPersistence
} from "../persistence/session-persistence.js";

export interface HandleTurnInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  now: string;
}

export class TextRealtimeSessionLoop {
  private readonly conversationRepository: ConversationMessageRepository;
  private readonly taskRepository: TaskRepository;
  private readonly taskEventRepository: TaskEventRepository;
  private readonly taskExecutorSessionRepository: TaskExecutorSessionRepository;
  private readonly taskExecutionService: TaskExecutionService;
  private readonly gateway: RealtimeGatewayService;

  constructor(
    executor: LocalExecutor = new MockExecutor(),
    persistence: SessionPersistence = createInMemorySessionPersistence()
  ) {
    this.conversationRepository = persistence.conversationRepository;
    this.taskRepository = persistence.taskRepository;
    this.taskEventRepository = persistence.taskEventRepository;
    this.taskExecutorSessionRepository =
      persistence.taskExecutorSessionRepository;

    this.taskExecutionService = new TaskExecutionService(
      new TaskRuntime(executor),
      this.taskExecutorSessionRepository,
      this.taskRepository,
      this.taskEventRepository
    );

    const handler = new FinalizedUtteranceHandler(
      new BrainTurnService(
        new ConversationOrchestrator(),
        this.taskExecutionService
      )
    );

    this.gateway = new RealtimeGatewayService(handler, this.taskRepository);
  }

  async handleTurn(input: HandleTurnInput): Promise<FinalizedUtteranceHandled> {
    await this.conversationRepository.save({
      brainSessionId: input.brainSessionId,
      speaker: "user",
      text: input.utterance.text,
      createdAt: input.now
    });

    const result = await this.gateway.handleFinalizedUtterance({
      brainSessionId: input.brainSessionId,
      utterance: input.utterance,
      now: input.now
    });

    await this.conversationRepository.save({
      brainSessionId: input.brainSessionId,
      speaker: "assistant",
      text: result.assistant.text,
      tone: result.assistant.tone,
      createdAt: input.now
    });

    return result;
  }

  async listConversation(
    brainSessionId: string
  ): Promise<ConversationMessage[]> {
    return this.conversationRepository.listByBrainSessionId(brainSessionId);
  }

  async listActiveTasks(brainSessionId: string): Promise<Task[]> {
    return this.taskRepository.listActiveByBrainSessionId(brainSessionId);
  }

  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.taskEventRepository.listByTaskId(taskId);
  }

  async waitForBackgroundWork(): Promise<void> {
    await this.taskExecutionService.waitForAll();
  }
}
