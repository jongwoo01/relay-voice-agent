export interface BrainSessionRecord {
  id: string;
  userId: string;
  status: "active" | "closed";
  source: "live" | "text_dev" | "desktop";
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

import type { SqlClientLike } from "./postgres-client.js";
import { normalizePostgresTimestamp } from "./postgres-value-normalizer.js";

export interface BrainSessionRepository {
  getById(brainSessionId: string): Promise<BrainSessionRecord | null>;
  create(session: BrainSessionRecord): Promise<void>;
  close(brainSessionId: string, closedAt: string): Promise<void>;
}

export class PostgresBrainSessionRepository implements BrainSessionRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async getById(brainSessionId: string): Promise<BrainSessionRecord | null> {
    const result = await this.sql.query<{
      id: string;
      user_id: string;
      status: BrainSessionRecord["status"];
      source: BrainSessionRecord["source"];
      created_at: string | Date;
      updated_at: string | Date;
      closed_at: string | Date | null;
    }>(
      `
        select
          id,
          user_id,
          status,
          source,
          created_at,
          updated_at,
          closed_at
        from brain_sessions
        where id = $1
      `,
      [brainSessionId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      source: row.source,
      createdAt: normalizePostgresTimestamp(row.created_at)!,
      updatedAt: normalizePostgresTimestamp(row.updated_at)!,
      closedAt: normalizePostgresTimestamp(row.closed_at) ?? null
    };
  }

  async create(session: BrainSessionRecord): Promise<void> {
    await this.sql.query(
      `
        insert into brain_sessions (
          id,
          user_id,
          status,
          source,
          created_at,
          updated_at,
          closed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        session.id,
        session.userId,
        session.status,
        session.source,
        session.createdAt,
        session.updatedAt,
        session.closedAt ?? null
      ]
    );
  }

  async close(brainSessionId: string, closedAt: string): Promise<void> {
    await this.sql.query(
      `
        update brain_sessions
        set status = 'closed',
            updated_at = $2,
            closed_at = $2
        where id = $1
      `,
      [brainSessionId, closedAt]
    );
  }
}
