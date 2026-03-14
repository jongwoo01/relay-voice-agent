import type { IntentType } from "@agent/shared-types";
import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";

const INTENT_LABELS = [
  "small_talk",
  "question",
  "task_request",
  "unclear"
] as const satisfies IntentType[];

const DEFAULT_INTENT_MODEL =
  process.env.GEMINI_INTENT_MODEL ?? "gemini-2.5-flash-lite";

export interface IntentResolution {
  intent: IntentType;
  assistantReplyText?: string;
}

function isIntentType(value: unknown): value is IntentType {
  return (
    typeof value === "string" &&
    INTENT_LABELS.includes(value as IntentType)
  );
}

function normalizeAssistantReplyText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseIntentResolution(text: string): IntentResolution {
  const normalized = text.trim();
  const parsed = JSON.parse(normalized) as {
    intent?: unknown;
    assistantReplyText?: unknown;
  };

  if (!isIntentType(parsed.intent)) {
    throw new Error(`Intent resolver returned an unknown label: ${normalized}`);
  }

  return {
    intent: parsed.intent,
    assistantReplyText: normalizeAssistantReplyText(parsed.assistantReplyText)
  };
}

export interface IntentResolver {
  resolve(text: string): Promise<IntentResolution>;
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

  async resolve(text: string): Promise<IntentResolution> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        "Classify the user's final utterance into exactly one intent.",
        "Return JSON only in the form {\"intent\":\"...\",\"assistantReplyText\":\"...\"}.",
        "Allowed intents: small_talk, question, task_request, unclear.",
        "Use task_request for actionable requests that should trigger work.",
        "Use task_request when answering requires inspecting local files, directories, apps, browser state, or running local tools or commands.",
        "Requests like 'tell me the files on my desktop', 'show me folder names', 'count files', 'find X on this machine', or 'open Y' are task_request, not question.",
        "Questions like 'what is on my desktop?', 'how many files are in downloads?', or 'can you see that folder?' are task_request if they refer to local machine state.",
        "Use question only when the answer can be produced directly without inspecting the local machine or performing work.",
        "Use small_talk for greetings, chit-chat, or acknowledgements.",
        "Use unclear when the request is too ambiguous to act on.",
        "If intent is task_request, set assistantReplyText to an empty string.",
        "If intent is small_talk or question, assistantReplyText must be a concise English reply in one or two short sentences.",
        "If intent is unclear, assistantReplyText must be a concise English clarification question.",
        "Do not mention internal routing, models, policies, or hidden reasoning.",
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
            },
            assistantReplyText: {
              type: "string"
            }
          },
          required: ["intent", "assistantReplyText"],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      throw new Error("Intent resolver returned an empty response");
    }

    return parseIntentResolution(response.text);
  }
}

export class ErrorIntentResolver implements IntentResolver {
  constructor(private readonly errorFactory: () => Error) {}

  async resolve(_text: string): Promise<IntentResolution> {
    throw this.errorFactory();
  }
}

export function createGeminiIntentClient(
  factory: GenAiClientFactory = createDefaultGenAiClientFactory()
): IntentModelClientLike {
  return factory.createModelsClient();
}

export function createDefaultIntentResolver(): IntentResolver {
  try {
    const factory = createDefaultGenAiClientFactory();
    return new GeminiIntentResolver(
      createGeminiIntentClient(factory),
      factory.getConfig().intentModel
    );
  } catch (error) {
    return new ErrorIntentResolver(() =>
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export { DEFAULT_INTENT_MODEL };
