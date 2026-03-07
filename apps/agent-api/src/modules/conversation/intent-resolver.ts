import { GoogleGenAI } from "@google/genai";
import type { IntentType } from "@agent/shared-types";

const ENGLISH_TASK_PREFIXES = [
  "code ",
  "build ",
  "create ",
  "write ",
  "fix ",
  "implement ",
  "organize ",
  "clean ",
  "summarize "
];

const INTENT_LABELS = [
  "small_talk",
  "question",
  "task_request",
  "unclear"
] as const satisfies IntentType[];

const DEFAULT_INTENT_MODEL = "gemini-2.5-flash";

function isIntentType(value: string): value is IntentType {
  return INTENT_LABELS.includes(value as IntentType);
}

function parseIntentFromModelText(text: string): IntentType {
  const normalized = text.trim();

  try {
    const parsed = JSON.parse(normalized) as { intent?: unknown };
    if (typeof parsed.intent === "string" && isIntentType(parsed.intent)) {
      return parsed.intent;
    }
  } catch {
    // Fall through to raw string parsing.
  }

  const singleToken = normalized.replace(/^"|"$/g, "");
  if (isIntentType(singleToken)) {
    return singleToken;
  }

  throw new Error(`Intent resolver returned an unknown label: ${normalized}`);
}

export function inferIntentFromText(text: string): IntentType {
  const normalized = text.trim().toLowerCase();

  if (
    normalized.includes("해줘") ||
    normalized.includes("실행") ||
    normalized.includes("정리") ||
    normalized.includes("만들어") ||
    normalized.includes("이어") ||
    normalized.includes("continue") ||
    normalized.includes("do ") ||
    normalized.includes("run ") ||
    ENGLISH_TASK_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return "task_request";
  }

  if (
    normalized.includes("?") ||
    normalized.startsWith("what") ||
    normalized.startsWith("why") ||
    normalized.startsWith("how") ||
    normalized.startsWith("when") ||
    normalized.startsWith("where")
  ) {
    return "question";
  }

  return "small_talk";
}

export interface IntentResolver {
  resolve(text: string): Promise<IntentType>;
}

export class HeuristicIntentResolver implements IntentResolver {
  async resolve(text: string): Promise<IntentType> {
    return inferIntentFromText(text);
  }
}

export interface IntentModelClientLike {
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

export class GeminiIntentResolver implements IntentResolver {
  constructor(
    private readonly client: IntentModelClientLike,
    private readonly model: string = DEFAULT_INTENT_MODEL
  ) {}

  async resolve(text: string): Promise<IntentType> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        "Classify the user's final utterance into exactly one intent.",
        "Return JSON only in the form {\"intent\":\"...\"}.",
        "Allowed intents: small_talk, question, task_request, unclear.",
        "Use task_request for actionable requests that should trigger work.",
        "Use question for information-seeking questions.",
        "Use small_talk for greetings, chit-chat, or acknowledgements.",
        "Use unclear when the request is too ambiguous to act on.",
        `Utterance: ${text}`
      ].join("\n"),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              enum: [...INTENT_LABELS]
            }
          },
          required: ["intent"],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      throw new Error("Intent resolver returned an empty response");
    }

    return parseIntentFromModelText(response.text);
  }
}

export class FallbackIntentResolver implements IntentResolver {
  constructor(
    private readonly primary: IntentResolver,
    private readonly fallback: IntentResolver
  ) {}

  async resolve(text: string): Promise<IntentType> {
    try {
      return await this.primary.resolve(text);
    } catch {
      return await this.fallback.resolve(text);
    }
  }
}

export function createGeminiIntentClient(apiKey: string): IntentModelClientLike {
  return new GoogleGenAI({ apiKey });
}

export function createDefaultIntentResolver(): IntentResolver {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const heuristic = new HeuristicIntentResolver();

  if (!apiKey) {
    return heuristic;
  }

  return new FallbackIntentResolver(
    new GeminiIntentResolver(createGeminiIntentClient(apiKey)),
    heuristic
  );
}

export { DEFAULT_INTENT_MODEL };
