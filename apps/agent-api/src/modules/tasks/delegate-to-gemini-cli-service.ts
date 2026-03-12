import type {
  AssistantEnvelope,
  Task,
  TaskEvent,
  TaskStatus
} from "@agent/shared-types";
import type { TaskRepository } from "../persistence/task-repository.js";
import type { TaskEventRepository } from "../persistence/task-event-repository.js";
import { InMemoryTaskRepository } from "../persistence/task-repository.js";
import { InMemoryTaskEventRepository } from "../persistence/task-event-repository.js";
import {
  TaskExecutionService,
  type ExecuteTaskResult
} from "./task-execution-service.js";

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
  action: "clarify" | "created" | "resumed" | "status";
  accepted: boolean;
  taskId?: string;
  status: TaskStatus;
  message: string;
  needsInput?: boolean;
  needsApproval?: boolean;
  summary?: string;
  verification?: "verified" | "uncertain";
  changes?: string[];
}

export interface DelegateAutoHandleResult {
  assistant: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
}

export type DelegateAutoHandle = (
  input: Pick<DelegateToGeminiCliInput, "brainSessionId" | "request" | "now">
) => Promise<DelegateAutoHandleResult>;

const STATUS_QUESTION_PATTERN =
  /(상태|진행 상황|어디까지|다 됐|완료|끝났|결과|뭐가 있었|확인했|읽어|읽었|보고|보고해|브리핑|요약|말해|설명|개수|갯수|몇 개|이름|목록|뭐였|무엇|어떤|다시|status|progress|result|update)/i;

const GENERIC_FOLLOW_UP_PATTERN =
  /(그거|그 작업|그 일|아까|방금|이어서|계속|resume|continue)/i;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeStatusQuestion(text: string): boolean {
  return STATUS_QUESTION_PATTERN.test(text.trim());
}

function looksLikeGenericFollowUp(text: string): boolean {
  return GENERIC_FOLLOW_UP_PATTERN.test(text.trim());
}

function matchesTaskText(text: string, task: Task): boolean {
  const normalizedText = normalize(text);
  if (!normalizedText) {
    return false;
  }

  return (
    normalizedText.includes(task.normalizedGoal) ||
    task.normalizedGoal.includes(normalizedText) ||
    normalizedText.includes(task.title.toLowerCase())
  );
}

function shouldTargetExistingTask(text: string, task: Task): boolean {
  return (
    looksLikeStatusQuestion(text) ||
    looksLikeGenericFollowUp(text) ||
    matchesTaskText(text, task)
  );
}

function isBlockedTaskStatus(status: TaskStatus): boolean {
  return status === "waiting_input" || status === "approval_required";
}

function buildStatusMessage(task: Task, latestEvent?: TaskEvent): string {
  if (task.completionReport?.summary) {
    return task.completionReport.summary;
  }

  if (latestEvent?.message) {
    return latestEvent.message;
  }

  switch (task.status) {
    case "queued":
      return "작업을 큐에 넣었어요.";
    case "running":
      return "작업을 계속 확인하고 있어요.";
    case "waiting_input":
      return "작업을 이어가려면 입력이 더 필요해요.";
    case "approval_required":
      return "작업을 이어가려면 승인이 필요해요.";
    case "completed":
      return "작업이 완료됐어요.";
    case "failed":
      return "작업이 실패했어요.";
    default:
      return "작업 상태를 확인했어요.";
  }
}

function toToolResult(
  action: DelegateToGeminiCliResult["action"],
  task: Task,
  latestEvent?: TaskEvent,
  accepted = true
): DelegateToGeminiCliResult {
  return {
    action,
    accepted,
    taskId: task.id,
    status: task.status,
    message: buildStatusMessage(task, latestEvent),
    needsInput: task.status === "waiting_input",
    needsApproval: task.status === "approval_required",
    summary: task.completionReport?.summary,
    verification: task.completionReport?.verification,
    changes: task.completionReport?.changes
  };
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

    if (!request) {
      return this.buildClarifyResult(
        "어떤 작업을 Gemini CLI에 맡길지 한 줄로 말해줘.",
        activeTasks[0] ?? recentTasks[0]
      );
    }

    const target = await this.resolveTargetTask({
      request,
      taskId: input.taskId,
      activeTasks,
      recentTasks
    });

    if (target.kind === "clarify") {
      return this.buildClarifyResult(
        "진행 중인 작업이 여러 개라서 어떤 작업인지 먼저 집어줘.",
        activeTasks[0] ?? recentTasks[0]
      );
    }

    if (mode === "status" || looksLikeStatusQuestion(request)) {
      const statusTask = target.task ?? recentTasks[0] ?? activeTasks[0];
      if (!statusTask) {
        return this.buildClarifyResult(
          "지금 확인할 작업이 없어요. 새 작업을 요청해줘."
        );
      }

      const latestEvent = await this.getLatestEvent(statusTask.id);
      return toToolResult("status", statusTask, latestEvent);
    }

    if (
      target.task &&
      target.task.status === "running"
    ) {
      const latestEvent = await this.getLatestEvent(target.task.id);
      return toToolResult("status", target.task, latestEvent);
    }

    if (
      target.task &&
      (mode === "resume" ||
        (isBlockedTaskStatus(target.task.status) &&
          !looksLikeStatusQuestion(request)))
    ) {
      const execution = await this.taskExecutionService.dispatch({
        brainSessionId: input.brainSessionId,
        taskId: target.task.id,
        text: request,
        now: input.now,
        existingTask: target.task
      });
      return toToolResult("resumed", execution.task, execution.events.at(-1));
    }

    const autoHandled = await this.autoHandle({
      brainSessionId: input.brainSessionId,
      request,
      now: input.now
    });

    if (!autoHandled.task) {
      return this.buildClarifyResult(
        autoHandled.assistant.text,
        activeTasks[0] ?? recentTasks[0]
      );
    }

    const action =
      activeTasks.some((task) => task.id === autoHandled.task?.id) ||
      target.task
        ? "resumed"
        : "created";

    return toToolResult(
      action,
      autoHandled.task,
      autoHandled.taskEvents?.at(-1)
    );
  }

  private async resolveTargetTask(input: {
    request: string;
    taskId?: string;
    activeTasks: Task[];
    recentTasks: Task[];
  }): Promise<{ kind: "task"; task?: Task } | { kind: "clarify" }> {
    if (input.taskId) {
      return {
        kind: "task",
        task: (await this.taskRepository.getById(input.taskId)) ?? undefined
      };
    }

    if (input.activeTasks.length === 0) {
      return { kind: "task", task: undefined };
    }

    const explicitMatches = input.activeTasks.filter((task) =>
      matchesTaskText(input.request, task)
    );
    if (explicitMatches.length === 1) {
      return { kind: "task", task: explicitMatches[0] };
    }

    if (explicitMatches.length > 1) {
      return { kind: "clarify" };
    }

    if (input.activeTasks.length === 1) {
      return shouldTargetExistingTask(input.request, input.activeTasks[0])
        ? { kind: "task", task: input.activeTasks[0] }
        : { kind: "task", task: undefined };
    }

    if (looksLikeGenericFollowUp(input.request)) {
      return { kind: "clarify" };
    }

    return { kind: "task", task: undefined };
  }

  private async getLatestEvent(taskId: string): Promise<TaskEvent | undefined> {
    const events = await this.taskEventRepository.listByTaskId(taskId);
    return events.at(-1);
  }

  private buildClarifyResult(
    message: string,
    fallbackTask?: Task
  ): DelegateToGeminiCliResult {
    return {
      action: "clarify",
      accepted: false,
      taskId: fallbackTask?.id,
      status: fallbackTask?.status ?? "running",
      message,
      needsInput: fallbackTask?.status === "waiting_input",
      needsApproval: fallbackTask?.status === "approval_required",
      summary: fallbackTask?.completionReport?.summary,
      verification: fallbackTask?.completionReport?.verification,
      changes: fallbackTask?.completionReport?.changes
    };
  }
}
