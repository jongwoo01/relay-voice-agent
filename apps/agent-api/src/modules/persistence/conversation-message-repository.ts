import type { ConversationMessage } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";
import { normalizePostgresTimestamp } from "./postgres-value-normalizer.js";

export interface ConversationMessageRepository {
  listByBrainSessionId(brainSessionId: string): Promise<ConversationMessage[]>;
  save(message: ConversationMessage): Promise<void>;
  replaceLatest(input: {
    brainSessionId: string;
    speaker: ConversationMessage["speaker"];
    text: string;
  }): Promise<boolean>;
}

export class InMemoryConversationMessageRepository
  implements ConversationMessageRepository
{
  private readonly messages = new Map<string, ConversationMessage[]>();

  async listByBrainSessionId(
    brainSessionId: string
  ): Promise<ConversationMessage[]> {
    return [...(this.messages.get(brainSessionId) ?? [])].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
  }

  async save(message: ConversationMessage): Promise<void> {
    const current = this.messages.get(message.brainSessionId) ?? [];
    this.messages.set(message.brainSessionId, [...current, message]);
  }

  async replaceLatest(input: {
    brainSessionId: string;
    speaker: ConversationMessage["speaker"];
    text: string;
  }): Promise<boolean> {
    const current = this.messages.get(input.brainSessionId) ?? [];
    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (current[index]?.speaker !== input.speaker) {
        continue;
      }

      current[index] = {
        ...current[index],
        text: input.text
      };
      this.messages.set(input.brainSessionId, [...current]);
      return true;
    }

    return false;
  }
}

export class PostgresConversationMessageRepository
  implements ConversationMessageRepository
{
  constructor(private readonly sql: SqlClientLike) {}

  async listByBrainSessionId(
    brainSessionId: string
  ): Promise<ConversationMessage[]> {
    const result = await this.sql.query<{
      brain_session_id: string;
      speaker: ConversationMessage["speaker"];
      text: string;
      created_at: string | Date;
      tone: ConversationMessage["tone"] | null;
    }>(
      `
        select
          brain_session_id,
          speaker,
          text,
          created_at,
          tone
        from conversation_messages
        where brain_session_id = $1
        order by created_at asc
      `,
      [brainSessionId]
    );

    return result.rows.map((row) => ({
      brainSessionId: row.brain_session_id,
      speaker: row.speaker,
      text: row.text,
      createdAt: normalizePostgresTimestamp(row.created_at)!,
      tone: row.tone ?? undefined
    }));
  }

  async save(message: ConversationMessage): Promise<void> {
    await this.sql.query(
      `
        insert into conversation_messages (
          brain_session_id,
          user_id,
          speaker,
          text,
          tone,
          created_at
        )
        select
          $1,
          bs.user_id,
          $2,
          $3,
          $4,
          $5
        from brain_sessions bs
        where bs.id = $1
      `,
      [
        message.brainSessionId,
        message.speaker,
        message.text,
        message.tone ?? null,
        message.createdAt
      ]
    );
  }

  async replaceLatest(input: {
    brainSessionId: string;
    speaker: ConversationMessage["speaker"];
    text: string;
  }): Promise<boolean> {
    const result = await this.sql.query<{ id: string }>(
      `
        with target as (
          select id
          from conversation_messages
          where brain_session_id = $1
            and speaker = $2
          order by created_at desc, id desc
          limit 1
        )
        update conversation_messages cm
        set text = $3
        from target
        where cm.id = target.id
        returning cm.id
      `,
      [input.brainSessionId, input.speaker, input.text]
    );

    return result.rows.length > 0;
  }
}
