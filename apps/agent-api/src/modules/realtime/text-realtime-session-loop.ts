import type {
  AssistantNotification,
  ConversationMessage,
  FinalizedUtterance,
  TaskIntakeSession,
  Task,
  TaskEvent
} from "@agent/shared-types";
import type { LocalExecutor } from "@agent/local-executor-protocol";
import { MockExecutor } from "@agent/gemini-cli-runner";
import { ConversationOrchestrator } from "../conversation/conversation-orchestrator.js";
import { BrainTurnService } from "../conversation/brain-turn-service.js";
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
import { buildAssistantFollowUpMessage } from "../tasks/task-event-announcer.js";
import { TaskIntakeService } from "../conversation/task-intake-service.js";
import type { TaskIntakeResolver } from "../conversation/task-intake-resolver.js";

export interface HandleTurnInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  now: string;
}

export type AssistantMessageListener = (
  notification: AssistantNotification
) => void | Promise<void>;

export interface TextRealtimeSessionLoopOptions {
  persistDirectAssistantReplies?: boolean;
  taskIntakeResolver?: TaskIntakeResolver;
}

export class TextRealtimeSessionLoop {
  private readonly conversationRepository: ConversationMessageRepository;
  private readonly taskRepository: TaskRepository;
  private readonly taskIntakeService: TaskIntakeService;
  private readonly taskEventRepository: TaskEventRepository;
  private readonly taskExecutorSessionRepository: TaskExecutorSessionRepository;
  private readonly taskExecutionService: TaskExecutionService;
  private readonly gateway: RealtimeGatewayService;
  private readonly persistDirectAssistantReplies: boolean;

  constructor(
    executor: LocalExecutor = new MockExecutor(),
    persistence: SessionPersistence = createInMemorySessionPersistence(),
    private readonly onAssistantMessage?: AssistantMessageListener,
    options: TextRealtimeSessionLoopOptions = {}
  ) {
    this.conversationRepository = persistence.conversationRepository;
    this.taskRepository = persistence.taskRepository;
    this.taskIntakeService = options.taskIntakeResolver
      ? new TaskIntakeService(
          persistence.taskIntakeRepository,
          undefined,
          options.taskIntakeResolver
        )
      : new TaskIntakeService(persistence.taskIntakeRepository);
    this.taskEventRepository = persistence.taskEventRepository;
    this.taskExecutorSessionRepository =
      persistence.taskExecutorSessionRepository;

    this.taskExecutionService = new TaskExecutionService(
      new TaskRuntime(executor),
      this.taskExecutorSessionRepository,
      this.taskRepository,
      this.taskEventRepository,
      async (notification) => {
        const followUpMessage = buildAssistantFollowUpMessage({
          brainSessionId: notification.brainSessionId,
          task: notification.task,
          event: notification.terminalEvent
        });

        if (!followUpMessage) {
          return;
        }

        await this.conversationRepository.save(followUpMessage.message);

        if (this.onAssistantMessage) {
          await this.onAssistantMessage(followUpMessage);
        }
      }
    );
    this.persistDirectAssistantReplies =
      options.persistDirectAssistantReplies ?? true;

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

    const activeTasks = await this.taskRepository.listActiveByBrainSessionId(
      input.brainSessionId
    );
    const intakeResolution = await this.taskIntakeService.handleTurn({
      brainSessionId: input.brainSessionId,
      utterance: input.utterance,
      activeTasks,
      now: input.now
    });

    if (intakeResolution.kind === "clarify") {
      if (this.persistDirectAssistantReplies) {
        await this.conversationRepository.save({
          brainSessionId: input.brainSessionId,
          speaker: "assistant",
          text: intakeResolution.replyText,
          tone: "clarify",
          createdAt: input.now
        });
      }

      return {
        assistant: {
          text: intakeResolution.replyText,
          tone: "clarify"
        }
      };
    }

    const gatewayInput =
      intakeResolution.kind === "ready"
        ? {
            ...input,
            utterance: {
            ...input.utterance,
            text: intakeResolution.executableText,
            intent: "task_request" as const
          }
        }
        : input;

    const result = await this.gateway.handleFinalizedUtterance({
      brainSessionId: gatewayInput.brainSessionId,
      utterance: gatewayInput.utterance,
      now: gatewayInput.now
    });

    if (intakeResolution.kind === "ready" && result.task) {
      await this.taskIntakeService.clear(input.brainSessionId);
    }

    if (this.persistDirectAssistantReplies) {
      await this.conversationRepository.save({
        brainSessionId: input.brainSessionId,
        speaker: "assistant",
        text: result.assistant.text,
        tone: result.assistant.tone,
        createdAt: input.now
      });
    }

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

  async listRecentTasks(brainSessionId: string, limit = 5): Promise<Task[]> {
    return this.taskRepository.listRecentByBrainSessionId(brainSessionId, limit);
  }

  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.taskEventRepository.listByTaskId(taskId);
  }

  async getActiveTaskIntake(
    brainSessionId: string
  ): Promise<TaskIntakeSession | null> {
    return this.taskIntakeService.getActive(brainSessionId);
  }

  async waitForBackgroundWork(): Promise<void> {
    await this.taskExecutionService.waitForAll();
  }
}
