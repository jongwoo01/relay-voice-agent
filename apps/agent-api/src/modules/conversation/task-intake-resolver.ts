import { GoogleGenAI } from "@google/genai";
import type { TaskIntakeSession, TaskIntakeSlot } from "@agent/shared-types";
import {
  extractFilledSlots,
  inferRequiredSlots,
  looksLikeStandaloneTaskRequest,
  type TaskIntakeAnalysis,
  type TaskIntakeFilledSlots
} from "@agent/brain-domain";

const TASK_INTAKE_MODEL = process.env.GEMINI_TASK_INTAKE_MODEL ?? "gemini-2.5-flash";
const SLOT_LABELS = [
  "target",
  "time",
  "scope",
  "location",
  "risk_ack"
] as const satisfies TaskIntakeSlot[];

const STANDALONE_TASK_DOMAIN_CUES = [
  /(메일|이메일|문자|메시지|연락|일정|약속|미팅|회의|캘린더|스케줄|브라우저|탭|파일|폴더|바탕화면|다운로드|메일함|워크스페이스|프로젝트|문서|사진)/
];

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

function parseStartResponse(text: string): TaskIntakeStartResponse {
  const parsed = JSON.parse(text) as {
    requiredSlots?: unknown;
    filledSlots?: unknown;
  };

  return {
    requiredSlots: normalizeSlotArray(parsed.requiredSlots),
    filledSlots: normalizeFilledSlots(parsed.filledSlots)
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
    requiredSlots: normalizeSlotArray(parsed.requiredSlots),
    filledSlots: normalizeFilledSlots(parsed.filledSlots)
  };
}

export class HeuristicTaskIntakeResolver implements TaskIntakeResolver {
  async analyzeStart(text: string): Promise<TaskIntakeAnalysis> {
    return {
      requiredSlots: inferRequiredSlots(text),
      filledSlots: extractFilledSlots(text)
    };
  }

  async analyzeUpdate(
    session: TaskIntakeSession,
    text: string
  ): Promise<TaskIntakeUpdateResponse> {
    const shouldReplace =
      looksLikeStandaloneTaskRequest(text) &&
      STANDALONE_TASK_DOMAIN_CUES.some((pattern) => pattern.test(text.toLowerCase()));

    return {
      resolution: shouldReplace ? "replace_task" : "answer_current_intake",
      requiredSlots: inferRequiredSlots(text),
      filledSlots: extractFilledSlots(text)
    };
  }
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

    return parseStartResponse(response.text);
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

export class FallbackTaskIntakeResolver implements TaskIntakeResolver {
  constructor(
    private readonly primary: TaskIntakeResolver,
    private readonly fallback: TaskIntakeResolver
  ) {}

  async analyzeStart(text: string): Promise<TaskIntakeAnalysis> {
    try {
      return await this.primary.analyzeStart(text);
    } catch {
      return await this.fallback.analyzeStart(text);
    }
  }

  async analyzeUpdate(
    session: TaskIntakeSession,
    text: string
  ): Promise<TaskIntakeUpdateResponse> {
    try {
      return await this.primary.analyzeUpdate(session, text);
    } catch {
      return await this.fallback.analyzeUpdate(session, text);
    }
  }
}

export function createGeminiTaskIntakeClient(
  apiKey: string
): TaskIntakeModelClientLike {
  return new GoogleGenAI({ apiKey });
}

export function createDefaultTaskIntakeResolver(): TaskIntakeResolver {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const heuristic = new HeuristicTaskIntakeResolver();

  if (!apiKey) {
    return heuristic;
  }

  return new FallbackTaskIntakeResolver(
    new GeminiTaskIntakeResolver(createGeminiTaskIntakeClient(apiKey)),
    heuristic
  );
}

export { TASK_INTAKE_MODEL };
