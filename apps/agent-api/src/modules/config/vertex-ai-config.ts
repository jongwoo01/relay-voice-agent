export type VertexAiFailureReason =
  | "auth_failed"
  | "quota_exhausted"
  | "config_invalid"
  | "upstream_error";

export type VertexAiFailureCode =
  | "invalid_argument"
  | "permission_denied"
  | "resource_exhausted"
  | "failed_precondition"
  | "unimplemented"
  | "unknown";

export interface VertexAiConfig {
  project: string;
  location: string;
  apiVersion: string;
  liveModel: string;
  taskRoutingModel: string;
  taskIntakeModel: string;
  intentModel: string;
}

export interface VertexAiRuntimeMetadata {
  backend: "vertexai";
  project: string;
  location: string;
  apiVersion: string;
  liveModel: string;
  taskRoutingModel: string;
  taskIntakeModel: string;
  intentModel: string;
}

export interface VertexAiFailureDetail {
  reason: VertexAiFailureReason;
  code: VertexAiFailureCode;
  message: string;
  rawCode?: string | number;
}

export class VertexAiConfigurationError extends Error {
  readonly reason: VertexAiFailureReason = "config_invalid";

  constructor(message: string) {
    super(message);
    this.name = "VertexAiConfigurationError";
  }
}

const DEFAULT_API_VERSION = "v1";
const DEFAULT_LIVE_MODEL = "gemini-2.0-flash-live-preview-04-09";
const DEFAULT_TASK_ROUTING_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_TASK_INTAKE_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_INTENT_MODEL = "gemini-2.5-flash-lite";

export function resolveVertexAiConfig(
  env: NodeJS.ProcessEnv = process.env
): VertexAiConfig {
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = env.GOOGLE_CLOUD_LOCATION?.trim();

  if (!project) {
    throw new VertexAiConfigurationError(
      "Vertex AI requires GOOGLE_CLOUD_PROJECT to be set."
    );
  }

  if (!location) {
    throw new VertexAiConfigurationError(
      "Vertex AI requires GOOGLE_CLOUD_LOCATION to be set."
    );
  }

  return {
    project,
    location,
    apiVersion: env.GOOGLE_GENAI_API_VERSION?.trim() || DEFAULT_API_VERSION,
    liveModel: env.LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
    taskRoutingModel:
      env.GEMINI_TASK_ROUTING_MODEL?.trim() || DEFAULT_TASK_ROUTING_MODEL,
    taskIntakeModel:
      env.GEMINI_TASK_INTAKE_MODEL?.trim() || DEFAULT_TASK_INTAKE_MODEL,
    intentModel: env.GEMINI_INTENT_MODEL?.trim() || DEFAULT_INTENT_MODEL
  };
}

export function toVertexAiRuntimeMetadata(
  config: VertexAiConfig
): VertexAiRuntimeMetadata {
  return {
    backend: "vertexai",
    project: config.project,
    location: config.location,
    apiVersion: config.apiVersion,
    liveModel: config.liveModel,
    taskRoutingModel: config.taskRoutingModel,
    taskIntakeModel: config.taskIntakeModel,
    intentModel: config.intentModel
  };
}

function findMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function findNestedCode(value: unknown): string | number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    code?: string | number;
    error?: { code?: string | number };
    cause?: unknown;
  };

  if (typeof candidate.code === "string" || typeof candidate.code === "number") {
    return candidate.code;
  }

  if (
    candidate.error &&
    (typeof candidate.error.code === "string" ||
      typeof candidate.error.code === "number")
  ) {
    return candidate.error.code;
  }

  if (candidate.cause) {
    return findNestedCode(candidate.cause);
  }

  return undefined;
}

function classifyVertexAiFailureCode(
  message: string,
  rawCode?: string | number
): VertexAiFailureCode {
  const normalizedCode =
    typeof rawCode === "number"
      ? String(rawCode)
      : typeof rawCode === "string"
        ? rawCode.toLowerCase()
        : "";

  if (
    normalizedCode === "400" ||
    normalizedCode.includes("invalid_argument") ||
    message.includes("invalid_argument")
  ) {
    return "invalid_argument";
  }

  if (
    normalizedCode === "401" ||
    normalizedCode === "403" ||
    normalizedCode.includes("permission_denied") ||
    message.includes("permission_denied") ||
    message.includes("unauthenticated") ||
    message.includes("forbidden") ||
    message.includes("auth")
  ) {
    return "permission_denied";
  }

  if (
    normalizedCode === "429" ||
    normalizedCode.includes("resource_exhausted") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit")
  ) {
    return "resource_exhausted";
  }

  if (
    normalizedCode === "412" ||
    normalizedCode.includes("failed_precondition") ||
    message.includes("failed_precondition")
  ) {
    return "failed_precondition";
  }

  if (
    normalizedCode === "501" ||
    normalizedCode.includes("unimplemented") ||
    message.includes("unimplemented")
  ) {
    return "unimplemented";
  }

  return "unknown";
}

export function extractVertexAiFailureDetail(
  error: unknown
): VertexAiFailureDetail {
  if (error instanceof VertexAiConfigurationError) {
    return {
      reason: "config_invalid",
      code: "invalid_argument",
      message: error.message
    };
  }

  const message = findMessage(error);
  const normalizedMessage = message.toLowerCase();
  const rawCode = findNestedCode(error);
  const code = classifyVertexAiFailureCode(normalizedMessage, rawCode);

  switch (code) {
    case "permission_denied":
      return {
        reason: "auth_failed",
        code,
        message,
        rawCode
      };
    case "resource_exhausted":
      return {
        reason: "quota_exhausted",
        code,
        message,
        rawCode
      };
    default:
      return {
        reason: "upstream_error",
        code,
        message,
        rawCode
      };
  }
}

export function classifyVertexAiFailure(
  error: unknown
): VertexAiFailureReason {
  return extractVertexAiFailureDetail(error).reason;
}

export function logVertexAiFailure(
  label: string,
  error: unknown,
  details: Record<string, unknown> = {}
): VertexAiFailureReason {
  const failure = extractVertexAiFailureDetail(error);
  console.error(
    `[vertex-ai] ${label} ${JSON.stringify({
      ...details,
      reason: failure.reason,
      code: failure.code,
      rawCode: failure.rawCode ?? null,
      message: failure.message,
      errorType: error instanceof Error ? error.name : typeof error
    })}`
  );
  return failure.reason;
}

export function buildVertexAiFailureMessage(
  reason: VertexAiFailureReason,
  detailMessage?: string | null
): string {
  const suffix = detailMessage?.trim() ? ` Cause: ${detailMessage.trim()}` : "";

  switch (reason) {
    case "auth_failed":
      return `The task could not start because Vertex AI authentication or permissions are invalid.${suffix}`;
    case "quota_exhausted":
      return `Task routing failed because the Vertex AI quota was exhausted.${suffix}`;
    case "config_invalid":
      return `The task could not start because the Vertex AI configuration is incomplete.${suffix}`;
    default:
      return `The Vertex AI request failed. Please try again in a moment.${suffix}`;
  }
}
