import type {
  ExecutorOutcome,
  ExecutorProgressListener,
  ExecutorRunResult
} from "@agent/local-executor-protocol";
import type {
  TaskCompletionReport,
  TaskEvent,
  TaskExecutionArtifact
} from "@agent/shared-types";

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
  usedSyntheticResult: boolean;
  unparsedLines: string[];
  hasRealResultEvent: boolean;
  detectedFormat: "stream-json" | "json" | "text";
}

// Keep this marker aligned with the local executor prompt contract in prompts.ts.
const REPORT_JSON_MARKER = "REPORT_JSON:";

function createSyntheticResultEvent(response: string): GeminiCliHeadlessEvent {
  return {
    type: "result",
    payload: {
      response
    }
  };
}

function parseHeadlessJsonResultObject(value: string): GeminiCliHeadlessEvent | null {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const embeddedObject = findFirstJsonObject(trimmed);
  if (embeddedObject && embeddedObject !== trimmed) {
    candidates.push(embeddedObject);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!isRecord(parsed) || typeof parsed.type === "string") {
        continue;
      }

      const looksLikeHeadlessJson =
        typeof parsed.response === "string" ||
        typeof parsed.message === "string" ||
        typeof parsed.output === "string" ||
        isRecord(parsed.stats) ||
        isRecord(parsed.error);

      if (!looksLikeHeadlessJson) {
        continue;
      }

      return {
        type: "result",
        payload: parsed.error
          ? {
              ...parsed,
              status: "error"
            }
          : parsed
      };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
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

function extractCompletionResponse(
  value: string | undefined
): {
  naturalAnswer?: string;
  report?: TaskCompletionReport;
} {
  if (!value) {
    return {};
  }

  const markerIndex = value.lastIndexOf(REPORT_JSON_MARKER);
  const trimmedValue = value.trim();
  const embeddedObject =
    markerIndex >= 0 ? null : findFirstJsonObject(trimmedValue);
  const naturalAnswer =
    markerIndex >= 0
      ? normalizedTextValue(value.slice(0, markerIndex))
      : embeddedObject && embeddedObject !== trimmedValue
        ? normalizedTextValue(trimmedValue.replace(embeddedObject, "").trim())
        : undefined;
  const reportCandidate =
    markerIndex >= 0
      ? value.slice(markerIndex + REPORT_JSON_MARKER.length)
      : value;
  const parsed = parseJsonObjectString(reportCandidate);
  if (!parsed) {
    return {
      naturalAnswer: normalizedTextValue(value)
    };
  }

  const summary = normalizedTextValue(firstNonEmptyString([parsed.summary]));
  const verification =
    parsed.verification === "verified" || parsed.verification === "uncertain"
      ? parsed.verification
      : undefined;

  if (!summary || !verification) {
    return {
      naturalAnswer: normalizedTextValue(value)
    };
  }

  const keyFindings = Array.isArray(parsed.keyFindings)
    ? parsed.keyFindings
        .filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
        .map((item) => normalizedTextValue(item))
        .filter((item): item is string => typeof item === "string")
    : [];

  const changes = Array.isArray(parsed.changes)
    ? parsed.changes
        .filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
        .map((item) => normalizedTextValue(item))
        .filter((item): item is string => typeof item === "string")
    : [];

  const question = normalizedTextValue(firstNonEmptyString([parsed.question]));

  return {
    naturalAnswer,
    report: {
      summary,
      detailedAnswer: naturalAnswer,
      keyFindings,
      verification,
      changes,
      question
    }
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

function normalizedTextValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
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

function extractToolId(event: GeminiCliHeadlessEvent): string | undefined {
  return firstNonEmptyString([
    event.payload.tool_id,
    event.payload.toolId,
    event.payload.id,
    isRecord(event.payload.tool) ? event.payload.tool.id : undefined
  ]);
}

function extractToolInput(event: GeminiCliHeadlessEvent): string | undefined {
  return stringifyIfPresent(
    firstDefined([
      event.payload.parameters,
      event.payload.arguments,
      isRecord(event.payload.tool) ? event.payload.tool.arguments : undefined,
      isRecord(event.payload.tool) ? event.payload.tool.parameters : undefined
    ])
  );
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

function extractEventTimestamp(
  event: GeminiCliHeadlessEvent,
  fallbackNow: string
): string {
  return (
    firstNonEmptyString([
      event.payload.timestamp,
      event.payload.createdAt,
      event.payload.created_at
    ]) ?? fallbackNow
  );
}

function firstDefined(values: Array<unknown>): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function buildTaskExecutionArtifact(
  taskId: string,
  seq: number,
  fallbackNow: string,
  event: GeminiCliHeadlessEvent,
  resolvedToolName?: string
): TaskExecutionArtifact {
  const createdAt = extractEventTimestamp(event, fallbackNow);
  const payloadJson = isRecord(event.payload) ? event.payload : undefined;
  const toolName = resolvedToolName ?? extractToolName(event);
  const role = firstNonEmptyString([
    event.payload.role,
    isRecord(event.payload.message) ? event.payload.message.role : undefined
  ]);
  const status =
    event.type === "tool_result"
      ? extractToolResultStatus(event)
      : event.type === "result"
        ? extractResultStatus(event)
        : undefined;

  switch (event.type) {
    case "init":
      return {
        taskId,
        seq,
        kind: "init",
        createdAt,
        title: "Executor started",
        body: firstNonEmptyString([
          event.payload.model,
          event.payload.session_id
        ]),
        payloadJson
      };
    case "message": {
      const text = extractMessageChunk(event) ?? stringifyIfPresent(event.payload);
      return {
        taskId,
        seq,
        kind: "message",
        createdAt,
        title: role === "assistant" ? "Assistant note" : `${role ?? "executor"} message`,
        body: text,
        role,
        payloadJson
      };
    }
    case "tool_use":
      return {
        taskId,
        seq,
        kind: "tool_use",
        createdAt,
        title: toolName ? `Requested tool: ${toolName}` : "Requested tool",
        body: extractToolInput(event),
        toolName,
        payloadJson
      };
    case "tool_result":
      return {
        taskId,
        seq,
        kind: "tool_result",
        createdAt,
        title: toolName ? `Tool result: ${toolName}` : "Tool result",
        body: firstNonEmptyString([
          event.payload.output,
          stringifyIfPresent(event.payload.result),
          stringifyIfPresent(event.payload.content)
        ]),
        toolName,
        status,
        payloadJson
      };
    case "error":
      return {
        taskId,
        seq,
        kind: "error",
        createdAt,
        title: "Executor error",
        body: extractErrorMessage(event),
        payloadJson
      };
    case "result":
      return {
        taskId,
        seq,
        kind: "result",
        createdAt,
        title: status ? `Final result: ${status}` : "Final result",
        body: extractResultResponse(event) ?? extractErrorMessage(event),
        status,
        payloadJson
      };
  }
}

function toProgressMessage(
  event: GeminiCliHeadlessEvent,
  resolvedToolName?: string
): string | undefined {
  switch (event.type) {
    case "tool_use": {
      const toolName = resolvedToolName ?? extractToolName(event) ?? "unknown_tool";
      return `Tool requested: ${toolName}`;
    }
    case "tool_result": {
      const toolName = resolvedToolName ?? extractToolName(event) ?? "unknown_tool";
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

  const jsonResultEvent = parseHeadlessJsonResultObject(trimmed);
  if (jsonResultEvent) {
    return {
      events: [jsonResultEvent],
      usedSyntheticResult: false,
      unparsedLines: [],
      hasRealResultEvent: true,
      detectedFormat: "json"
    };
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const events: GeminiCliHeadlessEvent[] = [];
  const unparsedLines: string[] = [];
  let hasRealResultEvent = false;

  for (const line of lines) {
    try {
      const event = parseGeminiCliEventLine(line);
      if (event.type === "result") {
        hasRealResultEvent = true;
      }
      events.push(event);
    } catch {
      unparsedLines.push(line);
    }
  }

  if (events.length === 0) {
    return {
      events: [createSyntheticResultEvent(trimmed)],
      usedSyntheticResult: true,
      unparsedLines: [...unparsedLines],
      hasRealResultEvent: false,
      detectedFormat: "text"
    };
  }

  let usedSyntheticResult = false;
  if (unparsedLines.length > 0 && !events.some((event) => event.type === "result")) {
    events.push(createSyntheticResultEvent(unparsedLines.join("\n")));
    usedSyntheticResult = true;
  }

  if (events.length === 0) {
    throw new Error("Gemini CLI output did not include any stream events");
  }

  return {
    events,
    usedSyntheticResult,
    unparsedLines: [...unparsedLines],
    hasRealResultEvent,
    detectedFormat: "stream-json"
  };
}

export interface BuildExecutorResultInput {
  taskId: string;
  now: string;
  output: ParsedGeminiCliOutput;
  onProgress?: ExecutorProgressListener;
  expectedFormat?: "stream-json" | "json";
}

function summarizeLinePreview(value: string | undefined, max = 160): string | null {
  const normalized = normalizedTextValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function createStructuredOutputContractError(
  output: ParsedGeminiCliOutput,
  expectedFormat: "stream-json" | "json"
): Error {
  const preview = summarizeLinePreview(output.unparsedLines[0]);
  const structuredEventCount = output.usedSyntheticResult
    ? Math.max(0, output.events.length - 1)
    : output.events.length;
  const context =
    structuredEventCount > 0
      ? ` Relay received ${structuredEventCount} structured event${structuredEventCount === 1 ? "" : "s"} before the output became unusable.`
      : "";
  const firstLine = preview
    ? ` First non-JSON stdout line: "${preview}".`
    : "";

  return new Error(
    `Gemini CLI did not return usable structured output in ${expectedFormat} mode.${firstLine}${context}`
  );
}

export async function buildExecutorResultFromGeminiCliOutput(
  input: BuildExecutorResultInput
): Promise<ExecutorRunResult> {
  const progressEvents: TaskEvent[] = [];
  const assistantMessages: string[] = [];
  const artifacts: TaskExecutionArtifact[] = [];
  const toolNamesById = new Map<string, string>();
  let sessionId: string | undefined;
  let completionMessage: string | undefined;
  let completionReport: TaskCompletionReport | undefined;
  let naturalFinalAnswer: string | undefined;
  let outcome: ExecutorOutcome = "completed";
  let sawResult = false;

  for (const event of input.output.events) {
    const toolId = extractToolId(event);
    const directToolName = extractToolName(event);
    if (event.type === "tool_use" && toolId && directToolName) {
      toolNamesById.set(toolId, directToolName);
    }
    const resolvedToolName =
      directToolName ?? (toolId ? toolNamesById.get(toolId) : undefined);

    artifacts.push(
      buildTaskExecutionArtifact(
        input.taskId,
        artifacts.length,
        input.now,
        event,
        resolvedToolName
      )
    );
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

    const progressMessage = toProgressMessage(event, resolvedToolName);
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
      const status = extractResultStatus(event);
      if (status === "error") {
        const resultError =
          extractErrorMessage(event) ??
          extractResultResponse(event) ??
          "Gemini CLI reported a final error.";
        throw new Error(`Gemini CLI final result error: ${resultError}`);
      }
      completionMessage = extractResultResponse(event);
      const parsedCompletion = extractCompletionResponse(completionMessage);
      naturalFinalAnswer = parsedCompletion.naturalAnswer;
      completionReport = parsedCompletion.report;
      if (status === "waiting_input") {
        outcome = "waiting_input";
      } else if (status === "approval_required") {
        outcome = "approval_required";
      }
    }

    if (event.type === "tool_result" && extractToolResultStatus(event) === "error") {
      const toolName = resolvedToolName ?? "unknown_tool";
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
  if (!completionReport) {
    const fallbackCompletion = extractCompletionResponse(assistantTranscript);
    naturalFinalAnswer ??= fallbackCompletion.naturalAnswer;
    completionReport = fallbackCompletion.report;
  }

  if (input.output.usedSyntheticResult && !completionReport) {
    throw createStructuredOutputContractError(
      input.output,
      input.expectedFormat ?? "stream-json"
    );
  }

  if (completionReport && !completionReport.detailedAnswer) {
    const assistantTranscriptStructured = assistantTranscript
      ? parseJsonObjectString(assistantTranscript)
      : null;
    completionReport = {
      ...completionReport,
      detailedAnswer:
        naturalFinalAnswer ??
        (assistantTranscript &&
        !assistantTranscriptStructured &&
        normalizedTextValue(assistantTranscript) !== completionReport.summary
          ? normalizedTextValue(assistantTranscript)
          : undefined)
    };
  }

  const finalMessage =
    outcome === "waiting_input" || outcome === "approval_required"
      ? completionReport?.question ??
        completionReport?.summary ??
        normalizedTextValue(completionMessage) ??
        "I need one more answer before I can continue."
      : completionReport
        ? completionReport.verification === "verified"
          ? completionReport.summary
          : `The task finished, but I still need stronger proof of the final result. ${completionReport.summary}`
        : "The task finished, but the structured result report was missing, so the final changes still need verification.";

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
    report: completionReport,
    artifacts
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
  return {
    events,
    usedSyntheticResult: false,
    unparsedLines: [],
    hasRealResultEvent: events.some((event) => event.type === "result"),
    detectedFormat: "stream-json"
  };
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
