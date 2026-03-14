import type {
  AssistantEnvelope,
  BrainTurnInput,
  NextAction,
  Task,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import { BrainTurnService } from "../conversation/brain-turn-service.js";
import type { TaskRoutingDecision } from "../conversation/task-routing-resolver.js";

export interface FinalizedUtteranceHandled {
  assistant: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
  action?: NextAction;
  routingDecision?: TaskRoutingDecision;
}

export class FinalizedUtteranceHandler {
  constructor(
    private readonly brainTurnService: BrainTurnService = new BrainTurnService()
  ) {}

  async handle(input: BrainTurnInput): Promise<FinalizedUtteranceHandled> {
    const result = await this.brainTurnService.handle(input);

    if (result.action.type === "reply") {
      return {
        routingDecision: result.routingDecision,
        assistant: {
          text: result.replyText ?? "I have a response ready.",
          tone: "reply"
        }
      };
    }

    if (
      result.action.type === "clarify" ||
      result.action.type === "task_intake_clarify"
    ) {
      return {
        action: result.action,
        routingDecision: result.routingDecision,
        assistant: {
          text: result.replyText ?? "Please be a little more specific.",
          tone: "clarify"
        }
      };
    }

    if (result.action.type === "error") {
      return {
        action: result.action,
        routingDecision: result.routingDecision,
        assistant: {
          text: result.replyText ?? "The Vertex AI request failed.",
          tone: "reply"
        }
      };
    }

    if (
      result.action.type === "set_completion_notification" ||
      result.action.type === "status"
    ) {
      return {
        action: result.action,
        routingDecision: result.routingDecision,
        task: result.task,
        taskEvents: result.taskEvents,
        executorSession: result.executorSession,
        assistant: {
          text: result.replyText ?? "I'll let you know as soon as the task finishes.",
          tone: "reply"
        }
      };
    }

    return {
      action: result.action,
      routingDecision: result.routingDecision,
      assistant: {
        text:
          result.action.type === "resume_task"
            ? "I'll continue from there. The task state will stay visible in the panel."
            : "I'll start the task now. Progress will stay visible in the panel.",
        tone: "task_ack"
      },
      task: result.task,
      taskEvents: result.taskEvents,
      executorSession: result.executorSession
    };
  }
}
