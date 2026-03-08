import type { BrainTurnInput, NextAction, Task, TaskEvent, TaskExecutorSession } from "@agent/shared-types";
import { ConversationOrchestrator } from "./conversation-orchestrator.js";
import { TaskExecutionService } from "../tasks/task-execution-service.js";

export interface BrainTurnResult {
  action: NextAction;
  replyText?: string;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export type TaskIdGenerator = () => string;

function defaultTaskIdGenerator(): string {
  return `task-${crypto.randomUUID()}`;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isCompletionNoticeRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return /(완료|끝|끝나|되면).*(알려|말해|보고)/.test(normalized);
}

function buildDirectReplyText(
  utteranceText: string,
  activeTasks: Task[]
): string {
  const normalized = normalizeText(utteranceText);

  if (activeTasks.length > 0 && isCompletionNoticeRequest(normalized)) {
    return "네, 지금 진행 중인 작업이 끝나면 바로 알려드릴게요.";
  }

  if (/^(ㅎㅇ|안녕|hello|hi)$/.test(normalized)) {
    return "안녕하세요. 필요한 작업을 말해주시면 바로 진행할게요.";
  }

  if (activeTasks.length > 0 && /(상태|진행|어디까지)/.test(normalized)) {
    return "현재 진행 상황은 Tasks 패널에서 바로 볼 수 있어요. 완료되면 제가 바로 브리핑할게요.";
  }

  return "알겠어요. 원하는 작업이나 질문을 조금만 더 구체적으로 말해줘.";
}

export class BrainTurnService {
  constructor(
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator(),
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly createTaskId: TaskIdGenerator = defaultTaskIdGenerator
  ) {}

  async handle(input: BrainTurnInput): Promise<BrainTurnResult> {
    if (input.activeTasks.length > 0 && isCompletionNoticeRequest(input.utterance.text)) {
      return {
        action: { type: "reply" },
        replyText: "네, 지금 진행 중인 작업이 끝나면 바로 알려드릴게요."
      };
    }

    const action = this.orchestrator.decide(input.utterance, input.activeTasks);

    if (action.type === "reply") {
      return {
        action,
        replyText: buildDirectReplyText(input.utterance.text, input.activeTasks)
      };
    }

    if (action.type === "clarify") {
      return {
        action,
        replyText: "조금 더 구체적으로 말해줘."
      };
    }

    const taskId = action.type === "resume_task" ? action.taskId : this.createTaskId();
    const existingTask =
      action.type === "resume_task"
        ? input.activeTasks.find((task) => task.id === action.taskId)
        : undefined;

    const taskResult = await this.taskExecutionService.dispatch({
      brainSessionId: input.brainSessionId,
      taskId,
      text: input.utterance.text,
      now: input.now,
      existingTask
    });

    return {
      action,
      task: taskResult.task,
      taskEvents: taskResult.events,
      executorSession: taskResult.executorSession
    };
  }
}
