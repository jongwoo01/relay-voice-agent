import type { TaskIntakeSession, TaskIntakeSlot } from "@agent/shared-types";
import {
  type TaskIntakeAnalysis,
  type TaskIntakeFilledSlots
} from "@agent/brain-domain";
import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";

const TASK_INTAKE_MODEL =
  process.env.GEMINI_TASK_INTAKE_MODEL ?? "gemini-2.5-flash-lite";
const SLOT_LABELS = [
  "target",
  "time",
  "scope",
  "location",
  "risk_ack"
] as const satisfies TaskIntakeSlot[];

interface TaskIntakeStartResponse {
  requiredSlots: TaskIntakeSlot[];
  filledSlots: TaskIntakeFilledSlots;
}

interface TaskIntakeUpdateResponse {
  resolution: "answer_current_intake" | "replace_task";
  requiredSlots: TaskIntakeSlot[];
  filledSlots: TaskIntakeFilledSlots;
}

export interface TaskIntakeResolver {
  analyzeStart(text: string): Promise<TaskIntakeAnalysis>;
  analyzeUpdate(
    session: TaskIntakeSession,
    text: string
  ): Promise<TaskIntakeUpdateResponse>;
}

function isSlot(value: unknown): value is TaskIntakeSlot {
  return typeof value === "string" && SLOT_LABELS.includes(value as TaskIntakeSlot);
}

function normalizeFilledSlots(value: unknown): TaskIntakeFilledSlots {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: TaskIntakeFilledSlots = {};
  for (const [key, slotValue] of Object.entries(value)) {
    if (!isSlot(key) || typeof slotValue !== "string" || slotValue.trim().length === 0) {
      continue;
    }

    result[key] = slotValue.trim();
  }
  return result;
}

function normalizeSlotArray(value: unknown): TaskIntakeSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSlot);
}

function dedupeSlots(slots: TaskIntakeSlot[]): TaskIntakeSlot[] {
  return [...new Set(slots)];
}

function isSelfContainedInspectionRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const hasInspectionVerb = [
    "check",
    "list",
    "show",
    "tell me",
    "look at",
    "scan",
    "read"
  ].some((token) => normalized.includes(token));
  const hasFileSystemTarget = [
    "desktop",
    "folder",
    "folders",
    "file",
    "files",
    "directory",
    "directories",
    "downloads",
    "documents"
  ].some((token) => normalized.includes(token));
  const hasOutputRule = [
    "count",
    "counts",
    "how many",
    "name",
    "names",
    "content",
    "contents",
    "list"
  ].some((token) => normalized.includes(token));

  return hasInspectionVerb && hasFileSystemTarget && hasOutputRule;
}

function sanitizeRequiredSlots(
  userText: string,
  requiredSlots: TaskIntakeSlot[],
  filledSlots: TaskIntakeFilledSlots
): TaskIntakeSlot[] {
  const filtered = requiredSlots.filter((slot) => !filledSlots[slot]);
  if (
    filtered.includes("scope") &&
    isSelfContainedInspectionRequest(userText)
  ) {
    return dedupeSlots(filtered.filter((slot) => slot !== "scope"));
  }

  return dedupeSlots(filtered);
}

function parseStartResponse(
  responseText: string,
  userText: string
): TaskIntakeStartResponse {
  const parsed = JSON.parse(responseText) as {
    requiredSlots?: unknown;
    filledSlots?: unknown;
  };
  const filledSlots = normalizeFilledSlots(parsed.filledSlots);

  return {
    requiredSlots: sanitizeRequiredSlots(
      userText,
      normalizeSlotArray(parsed.requiredSlots),
      filledSlots
    ),
    filledSlots
  };
}

function parseUpdateResponse(text: string): TaskIntakeUpdateResponse {
  const parsed = JSON.parse(text) as {
    resolution?: unknown;
    requiredSlots?: unknown;
    filledSlots?: unknown;
  };

  return {
    resolution:
      parsed.resolution === "replace_task"
        ? "replace_task"
        : "answer_current_intake",
    requiredSlots: dedupeSlots(normalizeSlotArray(parsed.requiredSlots)),
    filledSlots: normalizeFilledSlots(parsed.filledSlots)
  };
}

export interface TaskIntakeModelClientLike {
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

export class GeminiTaskIntakeResolver implements TaskIntakeResolver {
  constructor(
    private readonly client: TaskIntakeModelClientLike,
    private readonly model: string = TASK_INTAKE_MODEL
  ) {}

  async analyzeStart(text: string): Promise<TaskIntakeAnalysis> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        "Analyze a user request for task intake.",
        "Return JSON only.",
        "Determine only execution-critical required slots for this request.",
        "Do not ask for optional details.",
        "Allowed slots: target, time, scope, location, risk_ack.",
        "If the request can be executed immediately, return an empty requiredSlots array.",
        'Treat file inspection requests like "check my desktop and tell me the names and counts of folders and files" as immediately executable.',
        "Do not require scope when the user already specified the output format, such as names, counts, contents, or a simple listing.",
        "Fill only slots explicitly present in the user's text.",
        `User request: ${text}`
      ].join("\n"),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            requiredSlots: {
              type: "array",
              items: {
                type: "string",
                enum: [...SLOT_LABELS]
              }
            },
            filledSlots: {
              type: "object",
              properties: {
                target: { type: "string" },
                time: { type: "string" },
                scope: { type: "string" },
                location: { type: "string" },
                risk_ack: { type: "string" }
              },
              additionalProperties: false
            }
          },
          required: ["requiredSlots", "filledSlots"],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      throw new Error("Task intake resolver returned an empty response");
    }

    return parseStartResponse(response.text, text);
  }

  async analyzeUpdate(
    session: TaskIntakeSession,
    text: string
  ): Promise<TaskIntakeUpdateResponse> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        "Analyze a user's latest message while a task intake session is active.",
        "Return JSON only.",
        "Choose resolution:",
        '- "answer_current_intake" if the message answers the current missing task details, even partially.',
        '- "replace_task" if the message is a new standalone task request that should replace the current intake.',
        "Allowed slots: target, time, scope, location, risk_ack.",
        "Fill only the slots explicitly present in the latest user message.",
        `Active intake source text: ${session.sourceText}`,
        `Active intake working text: ${session.workingText}`,
        `Currently missing slots: ${session.missingSlots.join(", ") || "none"}`,
        `Latest user message: ${text}`
      ].join("\n"),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            resolution: {
              type: "string",
              enum: ["answer_current_intake", "replace_task"]
            },
            requiredSlots: {
              type: "array",
              items: {
                type: "string",
                enum: [...SLOT_LABELS]
              }
            },
            filledSlots: {
              type: "object",
              properties: {
                target: { type: "string" },
                time: { type: "string" },
                scope: { type: "string" },
                location: { type: "string" },
                risk_ack: { type: "string" }
              },
              additionalProperties: false
            }
          },
          required: ["resolution", "requiredSlots", "filledSlots"],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      throw new Error("Task intake update resolver returned an empty response");
    }

    return parseUpdateResponse(response.text);
  }
}

export class ErrorTaskIntakeResolver implements TaskIntakeResolver {
  constructor(private readonly errorFactory: () => Error) {}

  async analyzeStart(_text: string): Promise<TaskIntakeAnalysis> {
    throw this.errorFactory();
  }

  async analyzeUpdate(
    _session: TaskIntakeSession,
    _text: string
  ): Promise<TaskIntakeUpdateResponse> {
    throw this.errorFactory();
  }
}

export function createGeminiTaskIntakeClient(
  factory: GenAiClientFactory = createDefaultGenAiClientFactory()
): TaskIntakeModelClientLike {
  return factory.createModelsClient();
}

export function createDefaultTaskIntakeResolver(): TaskIntakeResolver {
  try {
    const factory = createDefaultGenAiClientFactory();
    return new GeminiTaskIntakeResolver(
      createGeminiTaskIntakeClient(factory),
      factory.getConfig().taskIntakeModel
    );
  } catch (error) {
    return new ErrorTaskIntakeResolver(() =>
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export { TASK_INTAKE_MODEL };
