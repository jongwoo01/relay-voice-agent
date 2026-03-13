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
import {
  createDefaultTaskRoutingResolver,
  type TaskRoutingDecision,
  type TaskRoutingResolver
} from "./task-routing-resolver.js";
import { buildTaskStatusMessage } from "../tasks/task-status-message.js";
import {
  buildVertexAiFailureMessage,
  classifyVertexAiFailure
} from "../config/vertex-ai-config.js";

export interface BrainTurnResult {
  action: NextAction;
  replyText?: string;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
  routingDecision?: TaskRoutingDecision;
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

function truncateForLog(value: string | null | undefined, max = 160): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function summarizeTasks(tasks: Task[]): Array<Record<string, unknown>> {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
    completionSummary: truncateForLog(task.completionReport?.summary)
  }));
}

function logBrainTurn(label: string, details: Record<string, unknown>): void {
  console.log(`[brain-turn] ${label} ${JSON.stringify(details)}`);
}

export class BrainTurnService {
  constructor(
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator(),
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly createTaskId: TaskIdGenerator = defaultTaskIdGenerator,
    private readonly taskRoutingResolver: TaskRoutingResolver = createDefaultTaskRoutingResolver()
  ) {}

  async handle(input: BrainTurnInput): Promise<BrainTurnResult> {
    logBrainTurn("handle start", {
      utterance: input.utterance.text,
      intent: input.utterance.intent,
      activeTasks: summarizeTasks(input.activeTasks),
      recentTasks: summarizeTasks(input.recentTasks ?? [])
    });
    if (
      input.activeTasks.length > 0 &&
      /(완료|끝|끝나|되면).*(알려|말해|보고)/.test(
        normalizeText(input.utterance.text)
      )
    ) {
      const action: NextAction = {
        type: "set_completion_notification",
        taskId: input.activeTasks[0].id
      };
      return {
        action,
        replyText: "네, 지금 진행 중인 작업이 끝나면 바로 알려드릴게요."
      };
    }

    if (input.utterance.intent === "small_talk" || input.utterance.intent === "question") {
      const action: NextAction = { type: "reply" };
      return {
        action,
        replyText: buildDirectReplyText(input.utterance.text, input.activeTasks)
      };
    }

    if (input.utterance.intent === "unclear") {
      const action: NextAction = { type: "clarify" };
      return {
        action,
        replyText: "조금 더 구체적으로 말해줘."
      };
    }

    let decision: TaskRoutingDecision;
    try {
      decision = await this.taskRoutingResolver.resolve({
        utterance: input.utterance,
        activeTasks: input.activeTasks,
        recentTasks: input.recentTasks ?? [],
        taskContexts: input.taskContexts
      });
    } catch (error) {
      const reason = classifyVertexAiFailure(error);
      const replyText = buildVertexAiFailureMessage(reason);
      logBrainTurn("routing error", {
        utterance: input.utterance.text,
        reason,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
      return {
        action: { type: "error", reason },
        replyText
      };
    }
    logBrainTurn("routing decision", {
      utterance: input.utterance.text,
      kind: decision.kind,
      targetTaskId: decision.targetTaskId,
      clarificationNeeded: decision.clarificationNeeded,
      clarificationText: truncateForLog(decision.clarificationText),
      executorPrompt: truncateForLog(decision.executorPrompt),
      reason: truncateForLog(decision.reason, 240)
    });

    if (decision.clarificationNeeded || decision.kind === "clarify") {
      const action: NextAction = { type: "clarify" };
      logBrainTurn("final action", {
        utterance: input.utterance.text,
        action: action.type,
        replyText: truncateForLog(
          decision.clarificationText ?? "조금 더 구체적으로 말해줘."
        )
      });
      return {
        action,
        replyText: decision.clarificationText ?? "조금 더 구체적으로 말해줘.",
        routingDecision: decision
      };
    }

    if (decision.kind === "reply") {
      const action: NextAction = { type: "reply" };
      logBrainTurn("final action", {
        utterance: input.utterance.text,
        action: action.type
      });
      return {
        action,
        replyText: buildDirectReplyText(input.utterance.text, input.activeTasks),
        routingDecision: decision
      };
    }

    if (decision.kind === "status") {
      const task = [...input.activeTasks, ...(input.recentTasks ?? [])].find(
        (candidate) => candidate.id === decision.targetTaskId
      );

      if (!task) {
        logBrainTurn("status target missing", {
          utterance: input.utterance.text,
          requestedTaskId: decision.targetTaskId
        });
        return {
          action: { type: "clarify" },
          replyText: "어떤 작업 상태를 확인할지 한 번만 더 짚어줘.",
          routingDecision: {
            ...decision,
            kind: "clarify",
            clarificationNeeded: true,
            clarificationText: "어떤 작업 상태를 확인할지 한 번만 더 짚어줘."
          }
        };
      }

      logBrainTurn("final action", {
        utterance: input.utterance.text,
        action: "status",
        taskId: task.id,
        taskStatus: task.status
      });
      return {
        action: { type: "status", taskId: task.id },
        replyText: buildTaskStatusMessage(task),
        task,
        routingDecision: decision
      };
    }

    const isResume =
      decision.kind === "continue_task" ||
      decision.kind === "continue_blocked_task";
    const taskId = isResume ? decision.targetTaskId : this.createTaskId();
    const existingTask = isResume
      ? input.activeTasks.find((task) => task.id === decision.targetTaskId) ??
        input.recentTasks?.find((task) => task.id === decision.targetTaskId)
      : undefined;

    if (isResume && (!taskId || !existingTask)) {
      logBrainTurn("resume target missing", {
        utterance: input.utterance.text,
        requestedTaskId: decision.targetTaskId
      });
      return {
        action: { type: "clarify" },
        replyText: "이어갈 작업을 정확히 못 잡았어. 어떤 작업인지 한 번만 더 말해줘.",
        routingDecision: {
          ...decision,
          kind: "clarify",
          clarificationNeeded: true,
          clarificationText:
            "이어갈 작업을 정확히 못 잡았어. 어떤 작업인지 한 번만 더 말해줘."
        }
      };
    }

    const action: NextAction = isResume
      ? { type: "resume_task", taskId: taskId! }
      : { type: "create_task" };

    const taskResult = await this.taskExecutionService.dispatch({
      brainSessionId: input.brainSessionId,
      taskId: taskId!,
      text: decision.executorPrompt ?? input.utterance.text,
      now: input.now,
      existingTask
    });
    logBrainTurn("final action", {
      utterance: input.utterance.text,
      action: action.type,
      taskId: taskResult.task.id,
      taskStatus: taskResult.task.status,
      executorPrompt: truncateForLog(decision.executorPrompt ?? input.utterance.text)
    });

    return {
      action,
      task: taskResult.task,
      taskEvents: taskResult.events,
      executorSession: taskResult.executorSession,
      routingDecision: decision
    };
  }
}
