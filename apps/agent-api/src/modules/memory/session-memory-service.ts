import {
  createDefaultGenAiClientFactory,
  type GenAiClientFactory
} from "../config/genai-client-factory.js";
import { buildSessionMemoryExtractionPrompt } from "../prompts/index.js";
import {
  InMemorySessionMemoryRepository,
  PostgresSessionMemoryRepository,
  SESSION_MEMORY_IMPORTANCE,
  SESSION_MEMORY_KINDS,
  type SessionMemoryImportance,
  type SessionMemoryItem,
  type SessionMemoryKind,
  type SessionMemoryRepository,
  type SessionMemoryUpsertInput
} from "../persistence/session-memory-repository.js";
import type { SqlClientLike } from "../persistence/postgres-client.js";

const SESSION_MEMORY_MODEL =
  process.env.GEMINI_SESSION_MEMORY_MODEL ?? "gemini-2.5-flash-lite";
const MAX_RUNTIME_MEMORY_ITEMS = 6;

export interface SessionMemoryExtractionItem {
  kind: SessionMemoryKind;
  key: string;
  summary: string;
  valueText: string;
  importance: SessionMemoryImportance;
  confidence: number;
}

export interface SessionMemoryExtractorInput {
  brainSessionId: string;
  text: string;
  now: string;
  existingItems: SessionMemoryItem[];
}

export interface SessionMemoryExtractor {
  extract(
    input: SessionMemoryExtractorInput
  ): Promise<SessionMemoryExtractionItem[]>;
}

export interface SessionMemoryServiceLike {
  rememberFromUtterance(input: {
    brainSessionId: string;
    text: string;
    now: string;
  }): Promise<{ updated: boolean; storedItems: SessionMemoryItem[] }>;
  buildRuntimeContext(brainSessionId: string): Promise<string>;
}

export interface SessionMemoryModelClientLike {
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

function isKind(value: unknown): value is SessionMemoryKind {
  return (
    typeof value === "string" &&
    SESSION_MEMORY_KINDS.includes(value as SessionMemoryKind)
  );
}

function isImportance(value: unknown): value is SessionMemoryImportance {
  return (
    typeof value === "string" &&
    SESSION_MEMORY_IMPORTANCE.includes(value as SessionMemoryImportance)
  );
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join("_")
    .replace(/[^a-z0-9_:-]/g, "");

  return compact.length > 0 && compact.length <= 64 ? compact : null;
}

function normalizeSummary(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const summary = value.trim();
  return summary.length > 0 && summary.length <= 240 ? summary : null;
}

function normalizeValueText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text.length > 0 && text.length <= 240 ? text : null;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeExtractionItems(text: string): SessionMemoryExtractionItem[] {
  const parsed = JSON.parse(text) as { storeItems?: unknown };
  if (!Array.isArray(parsed.storeItems)) {
    return [];
  }

  const deduped = new Map<string, SessionMemoryExtractionItem>();
  for (const candidate of parsed.storeItems) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const item = candidate as Record<string, unknown>;
    if (!isKind(item.kind)) {
      continue;
    }

    const key = normalizeKey(item.key);
    const summary = normalizeSummary(item.summary);
    const valueText = normalizeValueText(item.valueText);
    const importance = isImportance(item.importance) ? item.importance : "medium";

    if (!key || !summary || !valueText) {
      continue;
    }

    deduped.set(`${item.kind}:${key}`, {
      kind: item.kind,
      key,
      summary,
      valueText,
      importance,
      confidence: normalizeConfidence(item.confidence)
    });
  }

  return [...deduped.values()];
}

function buildExtractorPrompt(input: SessionMemoryExtractorInput): string {
  const existing = input.existingItems.map((item) => ({
    kind: item.kind,
    key: item.key,
    summary: item.summary,
    importance: item.importance
  }));

  return buildSessionMemoryExtractionPrompt({
    existingItemsJson: JSON.stringify(existing),
    text: input.text
  });
}

function valueJsonFor(item: SessionMemoryExtractionItem): Record<string, unknown> {
  return {
    text: item.valueText
  };
}

function itemsEqual(
  existing: SessionMemoryItem | undefined,
  candidate: SessionMemoryExtractionItem
): boolean {
  if (!existing) {
    return false;
  }

  return (
    existing.summary === candidate.summary &&
    existing.importance === candidate.importance &&
    existing.valueJson.text === candidate.valueText
  );
}

function importanceRank(importance: SessionMemoryImportance): number {
  switch (importance) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 3;
  }
}

export class GeminiSessionMemoryExtractor implements SessionMemoryExtractor {
  constructor(
    private readonly client: SessionMemoryModelClientLike,
    private readonly model: string = SESSION_MEMORY_MODEL
  ) {}

  async extract(
    input: SessionMemoryExtractorInput
  ): Promise<SessionMemoryExtractionItem[]> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: buildExtractorPrompt(input),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            storeItems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [...SESSION_MEMORY_KINDS]
                  },
                  key: { type: "string" },
                  summary: { type: "string" },
                  valueText: { type: "string" },
                  importance: {
                    type: "string",
                    enum: [...SESSION_MEMORY_IMPORTANCE]
                  },
                  confidence: { type: "number" }
                },
                required: [
                  "kind",
                  "key",
                  "summary",
                  "valueText",
                  "importance",
                  "confidence"
                ],
                additionalProperties: false
              }
            }
          },
          required: ["storeItems"],
          additionalProperties: false
        },
        temperature: 0
      }
    });

    if (!response.text) {
      return [];
    }

    return normalizeExtractionItems(response.text);
  }
}

export class NoopSessionMemoryExtractor implements SessionMemoryExtractor {
  async extract(): Promise<SessionMemoryExtractionItem[]> {
    return [];
  }
}

export class SessionMemoryService implements SessionMemoryServiceLike {
  constructor(
    private readonly repository: SessionMemoryRepository = new InMemorySessionMemoryRepository(),
    private readonly extractor: SessionMemoryExtractor = new NoopSessionMemoryExtractor()
  ) {}

  async rememberFromUtterance(input: {
    brainSessionId: string;
    text: string;
    now: string;
  }): Promise<{ updated: boolean; storedItems: SessionMemoryItem[] }> {
    const text = input.text.trim();
    if (!text) {
      return { updated: false, storedItems: [] };
    }

    const existingItems = await this.repository.listByBrainSessionId(input.brainSessionId);
    const extracted = await this.extractor.extract({
      brainSessionId: input.brainSessionId,
      text,
      now: input.now,
      existingItems
    });

    if (extracted.length === 0) {
      return { updated: false, storedItems: [] };
    }

    const existingByKey = new Map(
      existingItems.map((item) => [`${item.kind}:${item.key}`, item] as const)
    );
    const toUpsert: SessionMemoryUpsertInput[] = [];

    for (const item of extracted) {
      const existing = existingByKey.get(`${item.kind}:${item.key}`);
      if (itemsEqual(existing, item)) {
        continue;
      }

      toUpsert.push({
        brainSessionId: input.brainSessionId,
        kind: item.kind,
        key: item.key,
        summary: item.summary,
        valueJson: valueJsonFor(item),
        importance: item.importance,
        confidence: item.confidence,
        sourceText: text,
        now: input.now
      });
    }

    if (toUpsert.length === 0) {
      return {
        updated: false,
        storedItems: await this.repository.listByBrainSessionId(input.brainSessionId)
      };
    }

    await this.repository.upsertMany(toUpsert);
    return {
      updated: true,
      storedItems: await this.repository.listByBrainSessionId(input.brainSessionId)
    };
  }

  async buildRuntimeContext(brainSessionId: string): Promise<string> {
    const items = await this.repository.listByBrainSessionId(brainSessionId);
    if (items.length === 0) {
      return "";
    }

    const lines = items
      .sort((left, right) => {
        const importanceDelta =
          importanceRank(left.importance) - importanceRank(right.importance);
        if (importanceDelta !== 0) {
          return importanceDelta;
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, MAX_RUNTIME_MEMORY_ITEMS)
      .map((item) => `- ${item.summary}`);

    return [
      "Session memory for this conversation only:",
      ...lines,
      "Use these notes only when relevant. Do not invent any extra profile details."
    ].join("\n");
  }
}

export function createGeminiSessionMemoryClient(
  factory: GenAiClientFactory = createDefaultGenAiClientFactory()
): SessionMemoryModelClientLike {
  return factory.createModelsClient();
}

export function createDefaultSessionMemoryExtractor(): SessionMemoryExtractor {
  try {
    const factory = createDefaultGenAiClientFactory();
    return new GeminiSessionMemoryExtractor(
      createGeminiSessionMemoryClient(factory),
      SESSION_MEMORY_MODEL
    );
  } catch {
    return new NoopSessionMemoryExtractor();
  }
}

export function createSessionMemoryService(input?: {
  sql?: SqlClientLike;
  repository?: SessionMemoryRepository;
  extractor?: SessionMemoryExtractor;
}): SessionMemoryService {
  const repository =
    input?.repository ??
    (input?.sql
      ? new PostgresSessionMemoryRepository(input.sql)
      : new InMemorySessionMemoryRepository());

  return new SessionMemoryService(
    repository,
    input?.extractor ?? createDefaultSessionMemoryExtractor()
  );
}
