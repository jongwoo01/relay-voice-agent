import type {
  BrainTurnInput,
  NextAction,
  Task,
  TaskEvent,
  TaskExecutorSession,
  TaskIntakeSlot
} from "@agent/shared-types";
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

function buildDirectReplyText(
  utteranceText: string,
  activeTasks: Task[]
): string {
  const normalized = normalizeText(utteranceText);

  if (/^(ㅎㅇ|안녕|hello|hi)$/.test(normalized)) {
    return "안녕하세요. 필요한 작업을 말해주시면 바로 진행할게요.";
  }

  if (activeTasks.length > 0 && /(상태|진행|어디까지)/.test(normalized)) {
    return "현재 진행 상황은 Tasks 패널에서 바로 볼 수 있어요. 완료되면 제가 바로 브리핑할게요.";
  }

  return "알겠어요. 원하는 작업이나 질문을 조금만 더 구체적으로 말해줘.";
}

function describeMissingSlot(slot: TaskIntakeSlot): string {
  switch (slot) {
    case "target":
      return "누구에게 하려는 건지";
    case "time":
      return "언제 할지";
    case "scope":
      return "어디까지 정리할지";
    case "location":
      return "어느 위치에서 할지";
    case "risk_ack":
      return "지워도 괜찮은 범위인지";
    default:
      return "추가 정보";
  }
}

function buildTaskIntakeClarifyText(missingSlots: TaskIntakeSlot[]): string {
  if (missingSlots.length === 1) {
    return `바로 할게. 다만 ${describeMissingSlot(missingSlots[0])}만 알려줘.`;
  }

  const labels = missingSlots.map(describeMissingSlot);
  const head = labels.slice(0, -1).join(", ");
  const tail = labels.at(-1);
  return `좋아, 바로 움직일 수 있게 ${head} 그리고 ${tail}만 알려줘.`;
}

export class BrainTurnService {
  constructor(
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator(),
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly createTaskId: TaskIdGenerator = defaultTaskIdGenerator
  ) {}

  async handle(input: BrainTurnInput): Promise<BrainTurnResult> {
    const action = this.orchestrator.decide(input.utterance, input.activeTasks);

    if (action.type === "set_completion_notification") {
      return {
        action,
        replyText: "네, 지금 진행 중인 작업이 끝나면 바로 알려드릴게요."
      };
    }

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

    if (action.type === "task_intake_clarify") {
      return {
        action,
        replyText: buildTaskIntakeClarifyText(action.missingSlots)
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
