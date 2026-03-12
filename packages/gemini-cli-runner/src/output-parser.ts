import type {
  ExecutorOutcome,
  ExecutorProgressListener,
  ExecutorRunResult
} from "@agent/local-executor-protocol";
import type { TaskCompletionReport, TaskEvent } from "@agent/shared-types";

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

function parseJsonObjectString(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const withoutFences = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFences];
  const embeddedObject = findFirstJsonObject(withoutFences);
  if (embeddedObject && embeddedObject !== withoutFences) {
    candidates.push(embeddedObject);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function findFirstJsonObject(value: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractStructuredCompletionReport(
  value: string | undefined
): TaskCompletionReport | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseJsonObjectString(value);
  if (!parsed) {
    return undefined;
  }

  const summary = firstNonEmptyString([parsed.summary]);
  const verification =
    parsed.verification === "verified" || parsed.verification === "uncertain"
      ? parsed.verification
      : undefined;

  if (!summary || !verification) {
    return undefined;
  }

  const changes = Array.isArray(parsed.changes)
    ? parsed.changes.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const question = firstNonEmptyString([parsed.question]);

  return {
    summary,
    verification,
    changes,
    question
  };
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
    event.payload.output,
    event.payload.content,
    typeof event.payload.result === "string" ? event.payload.result : undefined,
    isRecord(event.payload.result) ? event.payload.result.response : undefined,
    isRecord(event.payload.result) ? event.payload.result.message : undefined,
    isRecord(event.payload.result) ? event.payload.result.text : undefined,
    isRecord(event.payload.result) ? event.payload.result.output : undefined,
    isRecord(event.payload.result) ? event.payload.result.content : undefined
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
  let completionReport: TaskCompletionReport | undefined;
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
      completionReport = extractStructuredCompletionReport(completionMessage);
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

  const assistantTranscript =
    assistantMessages.length > 0 ? assistantMessages.join("").trim() : undefined;

  completionMessage ??= assistantTranscript;
  completionReport ??= extractStructuredCompletionReport(assistantTranscript);

  const finalMessage =
    outcome === "waiting_input" || outcome === "approval_required"
      ? completionReport?.question ??
        completionReport?.summary ??
        completionMessage ??
        "작업을 이어가려면 답이 하나 더 필요해."
      : completionReport
        ? completionReport.verification === "verified"
          ? completionReport.summary
          : `작업은 끝났지만 실제 변경 근거는 더 확인이 필요해. ${completionReport.summary}`
        : "작업은 끝났지만 구조화된 결과 보고가 없어서 실제 변경 사항 확인이 더 필요해.";

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
    sessionId,
    report: completionReport
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
