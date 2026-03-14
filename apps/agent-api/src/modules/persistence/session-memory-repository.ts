import type { SqlClientLike } from "./postgres-client.js";
import { normalizePostgresTimestamp } from "./postgres-value-normalizer.js";

export const SESSION_MEMORY_KINDS = [
  "identity",
  "preference",
  "workflow",
  "constraint",
  "background",
  "current_context"
] as const;

export const SESSION_MEMORY_IMPORTANCE = ["high", "medium", "low"] as const;

export type SessionMemoryKind = (typeof SESSION_MEMORY_KINDS)[number];
export type SessionMemoryImportance = (typeof SESSION_MEMORY_IMPORTANCE)[number];

export interface SessionMemoryItem {
  id: string;
  brainSessionId: string;
  kind: SessionMemoryKind;
  key: string;
  summary: string;
  valueJson: Record<string, unknown>;
  importance: SessionMemoryImportance;
  confidence: number;
  sourceText?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMemoryUpsertInput {
  brainSessionId: string;
  kind: SessionMemoryKind;
  key: string;
  summary: string;
  valueJson: Record<string, unknown>;
  importance: SessionMemoryImportance;
  confidence: number;
  sourceText?: string | null;
  now: string;
}

export interface SessionMemoryRepository {
  listByBrainSessionId(brainSessionId: string): Promise<SessionMemoryItem[]>;
  upsertMany(items: SessionMemoryUpsertInput[]): Promise<void>;
}

export class InMemorySessionMemoryRepository implements SessionMemoryRepository {
  private readonly items = new Map<string, SessionMemoryItem[]>();
  private sequence = 0;

  async listByBrainSessionId(brainSessionId: string): Promise<SessionMemoryItem[]> {
    return [...(this.items.get(brainSessionId) ?? [])].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  }

  async upsertMany(items: SessionMemoryUpsertInput[]): Promise<void> {
    for (const input of items) {
      const current = this.items.get(input.brainSessionId) ?? [];
      const existing = current.find(
        (item) => item.kind === input.kind && item.key === input.key
      );

      if (existing) {
        existing.summary = input.summary;
        existing.valueJson = input.valueJson;
        existing.importance = input.importance;
        existing.confidence = input.confidence;
        existing.sourceText = input.sourceText ?? null;
        existing.updatedAt = input.now;
      } else {
        current.push({
          id: `session-memory-${++this.sequence}`,
          brainSessionId: input.brainSessionId,
          kind: input.kind,
          key: input.key,
          summary: input.summary,
          valueJson: input.valueJson,
          importance: input.importance,
          confidence: input.confidence,
          sourceText: input.sourceText ?? null,
          createdAt: input.now,
          updatedAt: input.now
        });
      }

      this.items.set(input.brainSessionId, current);
    }
  }
}

export class PostgresSessionMemoryRepository implements SessionMemoryRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async listByBrainSessionId(brainSessionId: string): Promise<SessionMemoryItem[]> {
    const result = await this.sql.query<{
      id: string;
      brain_session_id: string;
      kind: SessionMemoryKind;
      key: string;
      summary: string;
      value_json: Record<string, unknown>;
      importance: SessionMemoryImportance;
      confidence: number;
      source_text: string | null;
      created_at: string | Date;
      updated_at: string | Date;
    }>(
      `
        select
          id,
          brain_session_id,
          kind,
          key,
          summary,
          value_json,
          importance,
          confidence,
          source_text,
          created_at,
          updated_at
        from session_memory_items
        where brain_session_id = $1
        order by
          case importance
            when 'high' then 0
            when 'medium' then 1
            else 2
          end asc,
          updated_at desc
      `,
      [brainSessionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      brainSessionId: row.brain_session_id,
      kind: row.kind,
      key: row.key,
      summary: row.summary,
      valueJson: row.value_json,
      importance: row.importance,
      confidence: row.confidence,
      sourceText: row.source_text,
      createdAt: normalizePostgresTimestamp(row.created_at)!,
      updatedAt: normalizePostgresTimestamp(row.updated_at)!
    }));
  }

  async upsertMany(items: SessionMemoryUpsertInput[]): Promise<void> {
    for (const item of items) {
      await this.sql.query(
        `
          insert into session_memory_items (
            brain_session_id,
            kind,
            key,
            summary,
            value_json,
            importance,
            confidence,
            source_text,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $9)
          on conflict (brain_session_id, kind, key)
          do update
          set summary = excluded.summary,
              value_json = excluded.value_json,
              importance = excluded.importance,
              confidence = excluded.confidence,
              source_text = excluded.source_text,
              updated_at = excluded.updated_at
        `,
        [
          item.brainSessionId,
          item.kind,
          item.key,
          item.summary,
          JSON.stringify(item.valueJson),
          item.importance,
          item.confidence,
          item.sourceText ?? null,
          item.now
        ]
      );
    }
  }
}
