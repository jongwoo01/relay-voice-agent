import type { IntentType } from "@agent/shared-types";
import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";

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

const LOCAL_DOMAIN_HINTS = [
  "바탕화면",
  "데스크톱",
  "다운로드",
  "폴더",
  "파일",
  "workspace",
  "프로젝트",
  "브라우저",
  "탭",
  "앱",
  "로컬",
  "이 컴퓨터",
  "이 기기",
  "내 컴퓨터",
  "desktop",
  "downloads",
  "folder",
  "file"
];

const LOCAL_INSPECTION_QUESTION_HINTS = [
  "보이니",
  "보여",
  "있니",
  "뭐가",
  "무슨",
  "개수",
  "갯수",
  "몇 개",
  "얼마나",
  "이름",
  "목록",
  "뭐 있"
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
  const hasLocalDomainHint = LOCAL_DOMAIN_HINTS.some((hint) =>
    normalized.includes(hint)
  );
  const looksLikeLocalInspectionQuestion =
    hasLocalDomainHint &&
    (LOCAL_INSPECTION_QUESTION_HINTS.some((hint) => normalized.includes(hint)) ||
      normalized.includes("?"));

  if (
    normalized.includes("해줘") ||
    normalized.includes("알려줘") ||
    normalized.includes("보여줘") ||
    normalized.includes("찾아줘") ||
    normalized.includes("말해줘") ||
    normalized.includes("말해라") ||
    normalized.includes("말해") ||
    normalized.includes("실행") ||
    normalized.includes("정리") ||
    normalized.includes("만들어") ||
    normalized.includes("이어") ||
    normalized.includes("알려") ||
    normalized.includes("continue") ||
    normalized.includes("do ") ||
    normalized.includes("run ") ||
    looksLikeLocalInspectionQuestion ||
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
        "Use task_request when answering requires inspecting local files, directories, apps, browser state, or running local tools/commands.",
        "Requests like 'tell me the files on my desktop', 'show me folder names', 'count files', 'find X on this machine', or 'open Y' are task_request, not question.",
        "Questions like '내 바탕화면에 뭐가 있니?', '다운로드 폴더에 파일이 몇 개 있니?', or '보이니?' are task_request if they refer to local machine state.",
        "Use question for information-seeking questions.",
        "Use question only when the answer can be produced directly without inspecting the local machine or performing work.",
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

export class ErrorIntentResolver implements IntentResolver {
  constructor(private readonly errorFactory: () => Error) {}

  async resolve(_text: string): Promise<IntentType> {
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
