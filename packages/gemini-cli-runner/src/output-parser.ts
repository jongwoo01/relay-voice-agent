import type {
  ExecutorOutcome,
  ExecutorProgressListener,
  ExecutorRunResult
} from "@agent/local-executor-protocol";
import type { TaskEvent } from "@agent/shared-types";

export type GeminiCliHeadlessEventType =
  | "init"
  | "message"
  | "tool_use"
  | "tool_result"
  | "error"
  | "result";

export interface GeminiCliHeadlessEvent {
  type: GeminiCliHeadlessEventType;
  payload: Record<string, unknown>;
}

export interface ParsedGeminiCliOutput {
  events: GeminiCliHeadlessEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstNonEmptyString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function stringifyIfPresent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function extractSessionId(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.session_id,
    event.payload.sessionId,
    isRecord(event.payload.session) ? event.payload.session.id : undefined
  ]);
}

function extractMessageChunk(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.text,
    event.payload.delta,
    event.payload.content,
    isRecord(event.payload.message) ? event.payload.message.content : undefined,
    isRecord(event.payload.message) ? event.payload.message.text : undefined
  ]);
}

function extractToolName(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.name,
    event.payload.tool_name,
    event.payload.toolName,
    isRecord(event.payload.tool) ? event.payload.tool.name : undefined
  ]);
}

function extractResultResponse(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.response,
    event.payload.message,
    event.payload.text,
    isRecord(event.payload.result) ? event.payload.result.response : undefined
  ]);
}

function extractResultStatus(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.status,
    isRecord(event.payload.result) ? event.payload.result.status : undefined
  ]);
}

function extractErrorMessage(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.message,
    event.payload.output,
    event.payload.result,
    isRecord(event.payload.error) ? event.payload.error.message : undefined
  ]);
}

function extractToolResultStatus(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.status,
    isRecord(event.payload.result) ? event.payload.result.status : undefined
  ]);
}

function toProgressMessage(event: GeminiCliHeadlessEvent): string | undefined {
  switch (event.type) {
    case "tool_use": {
      const toolName = extractToolName(event) ?? "unknown_tool";
      return `Tool requested: ${toolName}`;
    }
    case "tool_result": {
      const toolName = extractToolName(event) ?? "unknown_tool";
      return `Tool finished: ${toolName}`;
    }
    case "error":
      return extractErrorMessage(event) ?? "Executor reported a warning";
    default:
      return undefined;
  }
}

export function parseGeminiCliEventLine(line: string): GeminiCliHeadlessEvent {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const eventType = firstNonEmptyString([parsed.type]);

  if (
    eventType !== "init" &&
    eventType !== "message" &&
    eventType !== "tool_use" &&
    eventType !== "tool_result" &&
    eventType !== "error" &&
    eventType !== "result"
  ) {
    throw new Error(`Gemini CLI emitted an unknown stream event: ${eventType ?? "missing"}`);
  }

  const { type: _ignoredType, ...payload } = parsed;

  return {
    type: eventType,
    payload
  };
}

export function parseGeminiCliOutput(stdout: string): ParsedGeminiCliOutput {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("Gemini CLI output was empty");
  }

  const events = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseGeminiCliEventLine);

  if (events.length === 0) {
    throw new Error("Gemini CLI output did not include any stream events");
  }

  return { events };
}

export interface BuildExecutorResultInput {
  taskId: string;
  now: string;
  output: ParsedGeminiCliOutput;
  onProgress?: ExecutorProgressListener;
}

export async function buildExecutorResultFromGeminiCliOutput(
  input: BuildExecutorResultInput
): Promise<ExecutorRunResult> {
  const progressEvents: TaskEvent[] = [];
  const assistantMessages: string[] = [];
  let sessionId: string | undefined;
  let completionMessage: string | undefined;
  let outcome: ExecutorOutcome = "completed";
  let sawResult = false;

  for (const event of input.output.events) {
    sessionId ??= extractSessionId(event);

    if (event.type === "message") {
      const role = firstNonEmptyString([
        event.payload.role,
        isRecord(event.payload.message) ? event.payload.message.role : undefined
      ]);

      if (role === "assistant") {
        const chunk = extractMessageChunk(event);
        if (chunk) {
          assistantMessages.push(chunk);
        }
      }
    }

    const progressMessage = toProgressMessage(event);
    if (progressMessage) {
      const progressEvent: TaskEvent = {
        taskId: input.taskId,
        type: "executor_progress",
        message: progressMessage,
        createdAt: input.now
      };
      progressEvents.push(progressEvent);
      if (input.onProgress) {
        await input.onProgress(progressEvent);
      }
    }

    if (event.type === "result") {
      sawResult = true;
      completionMessage = extractResultResponse(event);
      const status = extractResultStatus(event);
      if (status === "waiting_input") {
        outcome = "waiting_input";
      } else if (status === "approval_required") {
        outcome = "approval_required";
      }
    }

    if (event.type === "tool_result" && extractToolResultStatus(event) === "error") {
      const toolName = extractToolName(event) ?? "unknown_tool";
      const errorMessage =
        extractErrorMessage(event) ?? `Tool "${toolName}" failed during Gemini CLI execution`;
      throw new Error(`Gemini CLI tool failure (${toolName}): ${errorMessage}`);
    }
  }

  if (!sawResult) {
    throw new Error("Gemini CLI output did not include a final result event");
  }

  const finalMessage =
    completionMessage ??
    firstNonEmptyString([assistantMessages.join("").trim()]) ??
    "Gemini CLI completed without a final response message";

  return {
    progressEvents,
    completionEvent: {
      taskId: input.taskId,
      type:
        outcome === "waiting_input"
          ? "executor_waiting_input"
          : outcome === "approval_required"
            ? "executor_approval_required"
            : "executor_completed",
      message: finalMessage,
      createdAt: input.now
    },
    outcome,
    sessionId
  };
}

export function toExecutorProgressEvent(
  taskId: string,
  now: string,
  event: GeminiCliHeadlessEvent
): TaskEvent | undefined {
  const progressMessage = toProgressMessage(event);

  if (!progressMessage) {
    return undefined;
  }

  return {
    taskId,
    type: "executor_progress",
    message: progressMessage,
    createdAt: now
  };
}

export function createMockGeminiCliOutput(events: GeminiCliHeadlessEvent[]): ParsedGeminiCliOutput {
  return { events };
}

export function createToolUseEvent(
  toolName: string,
  args?: Record<string, unknown>
): GeminiCliHeadlessEvent {
  return {
    type: "tool_use",
    payload: {
      name: toolName,
      arguments: args
    }
  };
}

export function createToolResultEvent(
  toolName: string,
  result?: unknown
): GeminiCliHeadlessEvent {
  return {
    type: "tool_result",
    payload: {
      name: toolName,
      result: stringifyIfPresent(result)
    }
  };
}
