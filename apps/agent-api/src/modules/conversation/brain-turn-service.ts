import type {
  BrainTurnInput,
  NextAction,
  Task,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import { TaskExecutionService } from "../tasks/task-execution-service.js";
import {
  createTaskId as createDefaultTaskId,
  type TaskIdGenerator
} from "../tasks/task-id.js";
import {
  createDefaultTaskRoutingResolver,
  type TaskRoutingDecision,
  type TaskRoutingResolver
} from "./task-routing-resolver.js";
import { buildTaskStatusMessage } from "../tasks/task-status-message.js";
import {
  buildVertexAiFailureMessage,
  logVertexAiFailure
} from "../config/vertex-ai-config.js";

export interface BrainTurnResult {
  action: NextAction;
  replyText?: string;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
  routingDecision?: TaskRoutingDecision;
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
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly createTaskId: TaskIdGenerator = createDefaultTaskId,
    private readonly taskRoutingResolver: TaskRoutingResolver = createDefaultTaskRoutingResolver()
  ) {}

  async handle(input: BrainTurnInput): Promise<BrainTurnResult> {
    logBrainTurn("handle start", {
      utterance: input.utterance.text,
      intent: input.utterance.intent,
      activeTasks: summarizeTasks(input.activeTasks),
      recentTasks: summarizeTasks(input.recentTasks ?? [])
    });
    if (input.utterance.intent === "small_talk" || input.utterance.intent === "question") {
      const action: NextAction = { type: "reply" };
      return {
        action,
        replyText:
          input.utterance.assistantReplyText ??
          "Tell me what you want to do next."
      };
    }

    if (input.utterance.intent === "unclear") {
      const action: NextAction = { type: "clarify" };
      return {
        action,
        replyText:
          input.utterance.assistantReplyText ??
          "Please be a little more specific."
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
      const reason = logVertexAiFailure("brain-turn routing", error, {
        utterance: input.utterance.text,
        intent: input.utterance.intent,
        activeTaskCount: input.activeTasks.length,
        recentTaskCount: (input.recentTasks ?? []).length
      });
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
          decision.clarificationText ?? "Please be a little more specific."
        )
      });
      return {
        action,
        replyText: decision.clarificationText ?? "Please be a little more specific.",
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
        replyText:
          decision.clarificationText ??
          input.utterance.assistantReplyText ??
          "Tell me what you want to do next.",
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
          replyText: "Which task do you want a status update for?",
          routingDecision: {
            ...decision,
            kind: "clarify",
            clarificationNeeded: true,
            clarificationText: "Which task do you want a status update for?"
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

    if (decision.kind === "set_completion_notification") {
      const task = [...input.activeTasks, ...(input.recentTasks ?? [])].find(
        (candidate) => candidate.id === decision.targetTaskId
      );

      if (!task) {
        logBrainTurn("completion notification target missing", {
          utterance: input.utterance.text,
          requestedTaskId: decision.targetTaskId
        });
        return {
          action: { type: "clarify" },
          replyText: "Which task should I notify you about when it finishes?",
          routingDecision: {
            ...decision,
            kind: "clarify",
            clarificationNeeded: true,
            clarificationText:
              "Which task should I notify you about when it finishes?"
          }
        };
      }

      logBrainTurn("final action", {
        utterance: input.utterance.text,
        action: "set_completion_notification",
        taskId: task.id,
        taskStatus: task.status
      });
      return {
        action: { type: "set_completion_notification", taskId: task.id },
        replyText: "Okay. I'll let you know as soon as the current task finishes.",
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
        replyText: "I couldn't tell which task to continue. Tell me which one you mean.",
        routingDecision: {
          ...decision,
          kind: "clarify",
          clarificationNeeded: true,
          clarificationText:
            "I couldn't tell which task to continue. Tell me which one you mean."
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
