import type { TaskIntakeSession } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";

export interface TaskIntakeRepository {
  getActiveByBrainSessionId(
    brainSessionId: string
  ): Promise<TaskIntakeSession | null>;
  save(session: TaskIntakeSession): Promise<void>;
  clearActive(brainSessionId: string): Promise<void>;
}

export class InMemoryTaskIntakeRepository implements TaskIntakeRepository {
  private readonly sessions = new Map<string, TaskIntakeSession>();

  async getActiveByBrainSessionId(
    brainSessionId: string
  ): Promise<TaskIntakeSession | null> {
    return this.sessions.get(brainSessionId) ?? null;
  }

  async save(session: TaskIntakeSession): Promise<void> {
    this.sessions.set(session.brainSessionId, session);
  }

  async clearActive(brainSessionId: string): Promise<void> {
    this.sessions.delete(brainSessionId);
  }
}

interface StoredTaskIntakeRow {
  brain_session_id: string;
  status: TaskIntakeSession["status"];
  source_text: string;
  working_text: string;
  required_slots_json: TaskIntakeSession["requiredSlots"];
  filled_slots_json: TaskIntakeSession["filledSlots"];
  missing_slots_json: TaskIntakeSession["missingSlots"];
  last_question: string | null;
  created_at: string;
  updated_at: string;
}

export class PostgresTaskIntakeRepository implements TaskIntakeRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async getActiveByBrainSessionId(
    brainSessionId: string
  ): Promise<TaskIntakeSession | null> {
    const result = await this.sql.query<StoredTaskIntakeRow>(
      `
        select
          brain_session_id,
          status,
          source_text,
          working_text,
          required_slots_json,
          filled_slots_json,
          missing_slots_json,
          last_question,
          created_at,
          updated_at
        from task_intake_sessions
        where brain_session_id = $1
      `,
      [brainSessionId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      brainSessionId: row.brain_session_id,
      status: row.status,
      sourceText: row.source_text,
      workingText: row.working_text,
      requiredSlots: row.required_slots_json,
      filledSlots: row.filled_slots_json,
      missingSlots: row.missing_slots_json,
      lastQuestion: row.last_question ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async save(session: TaskIntakeSession): Promise<void> {
    await this.sql.query(
      `
        insert into task_intake_sessions (
          brain_session_id,
          status,
          source_text,
          working_text,
          required_slots_json,
          filled_slots_json,
          missing_slots_json,
          last_question,
          created_at,
          updated_at
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7::jsonb,
          $8,
          $9,
          $10
        )
        on conflict (brain_session_id) do update
        set
          status = excluded.status,
          source_text = excluded.source_text,
          working_text = excluded.working_text,
          required_slots_json = excluded.required_slots_json,
          filled_slots_json = excluded.filled_slots_json,
          missing_slots_json = excluded.missing_slots_json,
          last_question = excluded.last_question,
          updated_at = excluded.updated_at
      `,
      [
        session.brainSessionId,
        session.status,
        session.sourceText,
        session.workingText,
        JSON.stringify(session.requiredSlots),
        JSON.stringify(session.filledSlots),
        JSON.stringify(session.missingSlots),
        session.lastQuestion ?? null,
        session.createdAt,
        session.updatedAt
      ]
    );
  }

  async clearActive(brainSessionId: string): Promise<void> {
    await this.sql.query(
      `
        delete from task_intake_sessions
        where brain_session_id = $1
      `,
      [brainSessionId]
    );
  }
}
