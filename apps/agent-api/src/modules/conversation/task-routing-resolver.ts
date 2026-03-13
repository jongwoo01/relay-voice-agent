import type {
  FinalizedUtterance,
  Task,
  TaskRoutingTaskContext,
  TaskStatus
} from "@agent/shared-types";
import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";

const TASK_ROUTING_MODEL =
  process.env.GEMINI_TASK_ROUTING_MODEL ?? "gemini-2.5-flash";

const TASK_ROUTING_KINDS = [
  "reply",
  "clarify",
  "status",
  "continue_task",
  "continue_blocked_task",
  "create_task"
] as const;

export type TaskRoutingDecisionKind =
  (typeof TASK_ROUTING_KINDS)[number];

export interface TaskRoutingDecision {
  kind: TaskRoutingDecisionKind;
  targetTaskId: string | null;
  clarificationNeeded: boolean;
  clarificationText: string | null;
  executorPrompt: string | null;
  reason: string;
}

export interface TaskRoutingResolverInput {
  utterance: FinalizedUtterance;
  activeTasks: Task[];
  recentTasks: Task[];
  taskContexts?: TaskRoutingTaskContext[];
  explicitTaskId?: string;
  delegateMode?: "auto" | "new_task" | "resume" | "status";
}

export interface TaskRoutingResolver {
  resolve(input: TaskRoutingResolverInput): Promise<TaskRoutingDecision>;
}

export interface TaskRoutingModelClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: {
        responseMimeType: "application/json";
        responseJsonSchema: unknown;
        temperature: number;
      };
    }): Promise<{ text?: string | undefined }>;
  };
}

function isRoutingKind(value: unknown): value is TaskRoutingDecisionKind {
  return (
    typeof value === "string" &&
    TASK_ROUTING_KINDS.includes(value as TaskRoutingDecisionKind)
  );
}

function normalizeMaybeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeTargetTaskId(
  value: unknown,
  taskIds: Set<string>
): string | null {
  const taskId = normalizeMaybeString(value);
  if (!taskId) {
    return null;
  }

  return taskIds.has(taskId) ? taskId : null;
}

function parseTaskRoutingDecision(
  text: string,
  taskIds: Set<string>
): TaskRoutingDecision {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (!isRoutingKind(parsed.kind)) {
    throw new Error("Task routing resolver returned an unknown kind");
  }

  const clarificationNeeded = parsed.clarificationNeeded === true;
  const targetTaskId = normalizeTargetTaskId(parsed.targetTaskId, taskIds);
  const clarificationText = normalizeMaybeString(parsed.clarificationText);
  const executorPrompt = normalizeMaybeString(parsed.executorPrompt);
  const reason =
    normalizeMaybeString(parsed.reason) ??
    "Task routing resolver returned no reason";

  return {
    kind: parsed.kind,
    targetTaskId,
    clarificationNeeded,
    clarificationText,
    executorPrompt,
    reason
  };
}

function taskStatusLabel(status: TaskStatus): string {
  return status;
}

function truncateForLog(value: string | null | undefined, max = 160): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function logTaskRouting(label: string, details: Record<string, unknown>): void {
  console.log(`[task-routing] ${label} ${JSON.stringify(details)}`);
}

function createTaskContext(task: Task, activeTaskIds: Set<string>): TaskRoutingTaskContext {
  return {
    task,
    isActive: activeTaskIds.has(task.id),
    isRecentCompleted:
      !activeTaskIds.has(task.id) &&
      (task.status === "completed" ||
        task.status === "failed" ||
        task.status === "cancelled")
  };
}

function normalizeTaskContexts(
  input: TaskRoutingResolverInput
): TaskRoutingTaskContext[] {
  if (input.taskContexts && input.taskContexts.length > 0) {
    return input.taskContexts;
  }

  const activeTaskIds = new Set(input.activeTasks.map((task) => task.id));
  return [...input.activeTasks, ...input.recentTasks]
    .filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index)
    .map((task) => createTaskContext(task, activeTaskIds));
}

function serializeTaskContexts(taskContexts: TaskRoutingTaskContext[]): string {
  return JSON.stringify(
    taskContexts.map((context) => ({
      id: context.task.id,
      title: context.task.title,
      normalizedGoal: context.task.normalizedGoal,
      status: taskStatusLabel(context.task.status),
      isActive: context.isActive,
      isRecentCompleted: context.isRecentCompleted,
      createdAt: context.task.createdAt,
      updatedAt: context.task.updatedAt,
      completionSummary: context.task.completionReport?.summary ?? null,
      latestEventPreview: context.latestEventPreview ?? null
    }))
  );
}

export class GeminiTaskRoutingResolver implements TaskRoutingResolver {
  constructor(
    private readonly client: TaskRoutingModelClientLike,
    private readonly model: string = TASK_ROUTING_MODEL
  ) {}

  async resolve(input: TaskRoutingResolverInput): Promise<TaskRoutingDecision> {
    const taskContexts = normalizeTaskContexts(input);
    const activeTaskContexts = taskContexts.filter((context) => context.isActive);
    const recentCompletedTaskContexts = taskContexts.filter(
      (context) => context.isRecentCompleted
    );
    const otherRecentTaskContexts = taskContexts.filter(
      (context) => !context.isActive && !context.isRecentCompleted
    );
    const tasks = taskContexts.map((context) => context.task);
    const taskIds = new Set(tasks.map((task) => task.id));
    logTaskRouting("resolver input", {
      utterance: input.utterance.text,
      intent: input.utterance.intent,
      delegateMode: input.delegateMode ?? "auto",
      explicitTaskId: input.explicitTaskId ?? null,
      activeTasks: activeTaskContexts.map((context) => ({
        id: context.task.id,
        title: context.task.title,
        status: context.task.status,
        latestEventPreview: truncateForLog(context.latestEventPreview)
      })),
      recentCompletedTasks: recentCompletedTaskContexts.map((context) => ({
        id: context.task.id,
        title: context.task.title,
        status: context.task.status,
        completionSummary: truncateForLog(context.task.completionReport?.summary),
        latestEventPreview: truncateForLog(context.latestEventPreview)
      })),
      otherRecentTasks: otherRecentTaskContexts.map((context) => ({
        id: context.task.id,
        title: context.task.title,
        status: context.task.status,
        latestEventPreview: truncateForLog(context.latestEventPreview)
      }))
    });
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        "Route the user's latest local desktop task utterance.",
        "Return JSON only.",
        "You must decide exactly one kind:",
        "- reply: only for conversational non-task replies.",
        "- clarify: the task or action is ambiguous and needs a question.",
        "- status: the user wants a status/result update without new execution.",
        "- continue_task: continue an existing task that is not blocked.",
        "- continue_blocked_task: the user is answering a blocked task or giving more input to continue it.",
        "- create_task: start a brand new task.",
        "Prefer create_task when the user references the result of a recently completed task and asks for a new action.",
        "Treat completed tasks as references to past results by default, not as the default target to continue.",
        "If the user refers to a recently created folder/file/list/summary and asks to do something new with it, prefer create_task.",
        "Choose status only for explicit progress/result/completion questions.",
        "Choose continue_task or continue_blocked_task only when the user clearly wants the same task to keep going.",
        "Use only the provided task ids. If no task should be targeted, return null.",
        "If there are multiple plausible target tasks, choose clarify.",
        "If explicitTaskId is provided, either target that exact id or choose clarify.",
        "If delegateMode is status, prefer status or clarify.",
        "If delegateMode is resume, prefer continue_task or continue_blocked_task or clarify.",
        "If delegateMode is new_task, prefer create_task.",
        "For continue_task, continue_blocked_task, and create_task, executorPrompt must contain the exact prompt to send to the executor.",
        "Preserve the user's wording in executorPrompt. Only add the minimum necessary context if the user is clearly answering a blocked task.",
        "For clarify, set clarificationNeeded=true and provide a short Korean clarificationText.",
        "For non-clarify decisions, set clarificationNeeded=false and clarificationText=null.",
        'Example: "아까 만든 LLM 폴더에 현대 LLM 뉴스 txt 파일 만들어줘" -> create_task.',
        'Example: "아까 만든 폴더 작업 어디까지 됐어?" -> status.',
        'Example: "그 작업 이어서 해" -> continue_task.',
        `Utterance intent: ${input.utterance.intent}`,
        `Latest utterance: ${input.utterance.text}`,
        `delegateMode: ${input.delegateMode ?? "auto"}`,
        `explicitTaskId: ${input.explicitTaskId ?? "null"}`,
        `Active tasks: ${serializeTaskContexts(activeTaskContexts)}`,
        `Recent completed tasks: ${serializeTaskContexts(recentCompletedTaskContexts)}`,
        `Other recent tasks: ${serializeTaskContexts(otherRecentTaskContexts)}`
      ].join("\n"),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [...TASK_ROUTING_KINDS]
            },
            targetTaskId: {
              anyOf: [
                { type: "string" },
                { type: "null" }
              ]
            },
            clarificationNeeded: { type: "boolean" },
            clarificationText: {
              anyOf: [
                { type: "string" },
                { type: "null" }
              ]
            },
            executorPrompt: {
              anyOf: [
                { type: "string" },
                { type: "null" }
              ]
            },
            reason: { type: "string" }
          },
          required: [
            "kind",
            "targetTaskId",
            "clarificationNeeded",
            "clarificationText",
            "executorPrompt",
            "reason"
          ],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      logTaskRouting("resolver empty response", {
        utterance: input.utterance.text
      });
      throw new Error("Task routing resolver returned an empty response");
    }

    logTaskRouting("resolver raw response", {
      utterance: input.utterance.text,
      responseText: truncateForLog(response.text, 400)
    });
    const decision = parseTaskRoutingDecision(response.text, taskIds);
    logTaskRouting("resolver decision", {
      utterance: input.utterance.text,
      kind: decision.kind,
      targetTaskId: decision.targetTaskId,
      clarificationNeeded: decision.clarificationNeeded,
      clarificationText: truncateForLog(decision.clarificationText),
      executorPrompt: truncateForLog(decision.executorPrompt),
      reason: truncateForLog(decision.reason, 240)
    });
    return decision;
  }
}

export class SafeTaskRoutingResolver implements TaskRoutingResolver {
  async resolve(input: TaskRoutingResolverInput): Promise<TaskRoutingDecision> {
    if (input.utterance.intent === "small_talk" || input.utterance.intent === "question") {
      logTaskRouting("safe fallback reply", {
        utterance: input.utterance.text,
        intent: input.utterance.intent
      });
      return {
        kind: "reply",
        targetTaskId: null,
        clarificationNeeded: false,
        clarificationText: null,
        executorPrompt: null,
        reason: "Safe fallback preserved direct conversational reply"
      };
    }

    logTaskRouting("safe fallback clarify", {
      utterance: input.utterance.text,
      intent: input.utterance.intent
    });
    return {
      kind: "clarify",
      targetTaskId: null,
      clarificationNeeded: true,
      clarificationText: "어떤 작업으로 이해하면 될지 한 번만 더 짚어줘.",
      executorPrompt: null,
      reason: "Safe fallback avoids guessing task routing without a valid model decision"
    };
  }
}

export class FallbackTaskRoutingResolver implements TaskRoutingResolver {
  constructor(
    private readonly primary: TaskRoutingResolver,
    private readonly fallback: TaskRoutingResolver
  ) {}

  async resolve(input: TaskRoutingResolverInput): Promise<TaskRoutingDecision> {
    try {
      return await this.primary.resolve(input);
    } catch (error) {
      logTaskRouting("primary resolver failed", {
        utterance: input.utterance.text,
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
      });
      return await this.fallback.resolve(input);
    }
  }
}

export class ErrorTaskRoutingResolver implements TaskRoutingResolver {
  constructor(private readonly errorFactory: () => Error) {}

  async resolve(_input: TaskRoutingResolverInput): Promise<TaskRoutingDecision> {
    throw this.errorFactory();
  }
}

export function createGeminiTaskRoutingClient(
  factory: GenAiClientFactory = createDefaultGenAiClientFactory()
): TaskRoutingModelClientLike {
  return factory.createModelsClient();
}

export function createDefaultTaskRoutingResolver(): TaskRoutingResolver {
  try {
    const factory = createDefaultGenAiClientFactory();
    return new GeminiTaskRoutingResolver(
      createGeminiTaskRoutingClient(factory),
      factory.getConfig().taskRoutingModel
    );
  } catch (error) {
    return new ErrorTaskRoutingResolver(() =>
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export { TASK_ROUTING_MODEL };
