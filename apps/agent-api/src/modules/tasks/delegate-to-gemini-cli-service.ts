import type {
  AssistantEnvelope,
  NextAction,
  Task,
  TaskEvent,
  TaskStatus
} from "@agent/shared-types";
import type { TaskRepository } from "../persistence/task-repository.js";
import type { TaskEventRepository } from "../persistence/task-event-repository.js";
import { InMemoryTaskRepository } from "../persistence/task-repository.js";
import { InMemoryTaskEventRepository } from "../persistence/task-event-repository.js";
import {
  TaskExecutionService
} from "./task-execution-service.js";
import { buildTaskStatusMessage } from "./task-status-message.js";
import type { TaskRoutingDecision } from "../conversation/task-routing-resolver.js";
import type { VertexAiFailureReason } from "../config/vertex-ai-config.js";
import {
  buildVertexAiFailureMessage,
  logVertexAiFailure
} from "../config/vertex-ai-config.js";

export type DelegateToGeminiCliMode =
  | "auto"
  | "new_task"
  | "resume"
  | "status";

export interface DelegateToGeminiCliInput {
  brainSessionId: string;
  request: string;
  now: string;
  taskId?: string;
  mode?: DelegateToGeminiCliMode;
}

export interface DelegateToGeminiCliResult {
  action: "clarify" | "created" | "resumed" | "status" | "error";
  accepted: boolean;
  taskId?: string;
  status: TaskStatus;
  message: string;
  presentation?: DelegateResultPresentation;
  failureReason?: VertexAiFailureReason;
  needsInput?: boolean;
  needsApproval?: boolean;
  summary?: string;
  verification?: "verified" | "uncertain";
  changes?: string[];
}

export interface DelegateResultPresentation {
  ownership: "live" | "runtime";
  speechMode: "canonical" | "grounded_summary" | "freeform";
  speechText: string;
  allowLiveModelOutput: boolean;
}

export interface DelegateAutoHandleResult {
  assistant: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
  action?: NextAction;
  routingDecision?: TaskRoutingDecision;
}

export type DelegateAutoHandle = (
  input: Pick<DelegateToGeminiCliInput, "brainSessionId" | "request" | "now">
) => Promise<DelegateAutoHandleResult>;

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
    completionSummary: truncateForLog(task.completionReport?.summary)
  }));
}

function logDelegate(label: string, details: Record<string, unknown>): void {
  console.log(`[delegate-to-gemini-cli] ${label} ${JSON.stringify(details)}`);
}

function toToolResult(
  action: DelegateToGeminiCliResult["action"],
  task: Task,
  latestEvent?: TaskEvent,
  accepted = true
): DelegateToGeminiCliResult {
  const message = buildTaskStatusMessage(task, latestEvent);
  const presentation = buildPresentation({
    action,
    task,
    message
  });
  const result = {
    action,
    accepted,
    taskId: task.id,
    status: task.status,
    message,
    presentation,
    needsInput: task.status === "waiting_input",
    needsApproval: task.status === "approval_required",
    summary: task.completionReport?.summary,
    verification: task.completionReport?.verification,
    changes: task.completionReport?.changes
  };
  logDelegate("result", {
    action: result.action,
    accepted: result.accepted,
    taskId: result.taskId,
    status: result.status,
    message: truncateForLog(result.message),
    presentation,
    summary: truncateForLog(result.summary)
  });
  return result;
}

function buildPresentation({
  action,
  task,
  message
}: {
  action: DelegateToGeminiCliResult["action"];
  task: Task;
  message: string;
}): DelegateResultPresentation {
  if (task.status === "completed") {
    if (task.completionReport?.verification === "verified") {
      return {
        ownership: "runtime",
        speechMode: "grounded_summary",
        speechText: task.completionReport.summary || message,
        allowLiveModelOutput: false
      };
    }

    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        task.completionReport?.summary ||
        "작업은 끝났지만 실제 결과 확인이 더 필요해요.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "failed") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message || "작업이 실패했어요.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "waiting_input" || task.status === "approval_required") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message,
      allowLiveModelOutput: false
    };
  }

  if (task.status === "queued" || task.status === "running" || task.status === "created") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        action === "created" || action === "resumed"
          ? "작업을 시작했어요. 완료나 실패가 확인되면 바로 알려드릴게요."
          : "아직 진행 중입니다. 완료나 실패가 확인되면 바로 알려드릴게요.",
      allowLiveModelOutput: false
    };
  }

  return {
    ownership: "live",
    speechMode: "freeform",
    speechText: message,
    allowLiveModelOutput: true
  };
}

function createTaskId(): string {
  return `task-${crypto.randomUUID()}`;
}

export class DelegateToGeminiCliService {
  constructor(
    private readonly taskRepository: TaskRepository = new InMemoryTaskRepository(),
    private readonly taskEventRepository: TaskEventRepository = new InMemoryTaskEventRepository(),
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly autoHandle: DelegateAutoHandle
  ) {}

  async handle(
    input: DelegateToGeminiCliInput
  ): Promise<DelegateToGeminiCliResult> {
    const request = input.request.trim();
    const mode = input.mode ?? "auto";
    const activeTasks = await this.taskRepository.listActiveByBrainSessionId(
      input.brainSessionId
    );
    const recentTasks = await this.taskRepository.listRecentByBrainSessionId(
      input.brainSessionId,
      8
    );
    logDelegate("handle start", {
      brainSessionId: input.brainSessionId,
      mode,
      taskId: input.taskId ?? null,
      request,
      activeTasks: summarizeTasks(activeTasks),
      recentTasks: summarizeTasks(recentTasks)
    });

    if (!request) {
      return this.buildClarifyResult(
        "어떤 작업을 Gemini CLI에 맡길지 한 줄로 말해줘.",
        activeTasks[0] ?? recentTasks[0]
      );
    }

    if (mode === "status" && input.taskId) {
      return this.handleExplicitStatus(input.taskId, activeTasks, recentTasks);
    }

    if (mode === "resume" && input.taskId) {
      return this.handleExplicitResume(input, activeTasks, recentTasks);
    }

    if (mode === "new_task") {
      const created = await this.taskExecutionService.dispatch({
        brainSessionId: input.brainSessionId,
        taskId: createTaskId(),
        text: request,
        now: input.now
      });

      return toToolResult("created", created.task, created.events.at(-1));
    }

    let autoHandled: DelegateAutoHandleResult;
    try {
      autoHandled = await this.autoHandle({
        brainSessionId: input.brainSessionId,
        request,
        now: input.now
      });
    } catch (error) {
      const reason = logVertexAiFailure("delegate auto-handle", error, {
        brainSessionId: input.brainSessionId,
        mode,
        taskId: input.taskId ?? null,
        request
      });
      return this.buildErrorResult(
        buildVertexAiFailureMessage(reason),
        reason,
        activeTasks[0] ?? recentTasks[0]
      );
    }
    logDelegate("auto handle result", {
      brainSessionId: input.brainSessionId,
      mode,
      request,
      action: autoHandled.action?.type ?? null,
      taskId: autoHandled.task?.id ?? null,
      taskStatus: autoHandled.task?.status ?? null,
      assistantText: truncateForLog(autoHandled.assistant.text),
      routingDecision: autoHandled.routingDecision
        ? {
            kind: autoHandled.routingDecision.kind,
            targetTaskId: autoHandled.routingDecision.targetTaskId,
            clarificationNeeded: autoHandled.routingDecision.clarificationNeeded,
            clarificationText: truncateForLog(
              autoHandled.routingDecision.clarificationText
            ),
            executorPrompt: truncateForLog(
              autoHandled.routingDecision.executorPrompt
            ),
            reason: truncateForLog(autoHandled.routingDecision.reason, 240)
          }
        : null
    });

    if (autoHandled.action?.type === "status" && autoHandled.task) {
      const latestEvent = await this.getLatestEvent(autoHandled.task.id);
      return toToolResult("status", autoHandled.task, latestEvent);
    }

    if (autoHandled.action?.type === "create_task" && autoHandled.task) {
      return toToolResult("created", autoHandled.task, autoHandled.taskEvents?.at(-1));
    }

    if (autoHandled.action?.type === "resume_task" && autoHandled.task) {
      return toToolResult("resumed", autoHandled.task, autoHandled.taskEvents?.at(-1));
    }

    if (autoHandled.action?.type === "error") {
      return this.buildErrorResult(
        autoHandled.assistant.text,
        autoHandled.action.reason,
        activeTasks[0] ?? recentTasks[0]
      );
    }

    return this.buildClarifyResult(
      autoHandled.assistant.text,
      activeTasks[0] ?? recentTasks[0]
    );
  }

  private async handleExplicitStatus(
    taskId: string,
    activeTasks: Task[],
    recentTasks: Task[]
  ): Promise<DelegateToGeminiCliResult> {
    const task =
      (await this.taskRepository.getById(taskId)) ??
      activeTasks.find((candidate) => candidate.id === taskId) ??
      recentTasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      return this.buildClarifyResult("확인할 작업을 찾지 못했어.", activeTasks[0] ?? recentTasks[0]);
    }

    const latestEvent = await this.getLatestEvent(task.id);
    return toToolResult("status", task, latestEvent);
  }

  private async handleExplicitResume(
    input: DelegateToGeminiCliInput,
    activeTasks: Task[],
    recentTasks: Task[]
  ): Promise<DelegateToGeminiCliResult> {
    const task =
      (input.taskId ? await this.taskRepository.getById(input.taskId) : null) ??
      activeTasks.find((candidate) => candidate.id === input.taskId) ??
      recentTasks.find((candidate) => candidate.id === input.taskId);

    if (!task) {
      return this.buildClarifyResult(
        "이어갈 작업을 찾지 못했어.",
        activeTasks[0] ?? recentTasks[0]
      );
    }

    const execution = await this.taskExecutionService.dispatch({
      brainSessionId: input.brainSessionId,
      taskId: task.id,
      text: input.request.trim(),
      now: input.now,
      existingTask: task
    });

    return toToolResult("resumed", execution.task, execution.events.at(-1));
  }

  private async getLatestEvent(taskId: string): Promise<TaskEvent | undefined> {
    const events = await this.taskEventRepository.listByTaskId(taskId);
    return events.at(-1);
  }

  private buildClarifyResult(
    message: string,
    fallbackTask?: Task
  ): DelegateToGeminiCliResult {
    const presentation: DelegateResultPresentation = {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message,
      allowLiveModelOutput: false
    };
    logDelegate("clarify result", {
      message: truncateForLog(message),
      presentation,
      fallbackTaskId: fallbackTask?.id ?? null,
      fallbackTaskStatus: fallbackTask?.status ?? null,
      fallbackTaskTitle: fallbackTask?.title ?? null
    });
    return {
      action: "clarify",
      accepted: false,
      taskId: fallbackTask?.id,
      status: fallbackTask?.status ?? "failed",
      message,
      presentation,
      needsInput: fallbackTask?.status === "waiting_input",
      needsApproval: fallbackTask?.status === "approval_required",
      summary: fallbackTask?.completionReport?.summary,
      verification: fallbackTask?.completionReport?.verification,
      changes: fallbackTask?.completionReport?.changes
    };
  }

  private buildErrorResult(
    message: string,
    failureReason: VertexAiFailureReason,
    fallbackTask?: Task
  ): DelegateToGeminiCliResult {
    const presentation: DelegateResultPresentation = {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message,
      allowLiveModelOutput: false
    };
    logDelegate("error result", {
      message: truncateForLog(message),
      failureReason,
      presentation,
      fallbackTaskId: fallbackTask?.id ?? null,
      fallbackTaskStatus: fallbackTask?.status ?? null,
      fallbackTaskTitle: fallbackTask?.title ?? null
    });
    return {
      action: "error",
      accepted: false,
      taskId: fallbackTask?.id,
      status: "failed",
      message,
      presentation,
      failureReason,
      needsInput: false,
      needsApproval: false,
      summary: fallbackTask?.completionReport?.summary,
      verification: fallbackTask?.completionReport?.verification,
      changes: fallbackTask?.completionReport?.changes
    };
  }
}
