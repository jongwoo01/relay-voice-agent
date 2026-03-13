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
          text: result.replyText ?? "응답을 준비했어요.",
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
          text: result.replyText ?? "조금 더 구체적으로 말해줘.",
          tone: "clarify"
        }
      };
    }

    if (result.action.type === "error") {
      return {
        action: result.action,
        routingDecision: result.routingDecision,
        assistant: {
          text: result.replyText ?? "Vertex AI 호출이 실패했습니다.",
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
          text: result.replyText ?? "작업이 끝나면 바로 알려드릴게요.",
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
            ? "이어서 진행할게. 작업 상태는 패널에 보여줄게."
            : "작업을 시작할게. 진행 상황은 패널에 보여줄게.",
        tone: "task_ack"
      },
      task: result.task,
      taskEvents: result.taskEvents,
      executorSession: result.executorSession
    };
  }
}
