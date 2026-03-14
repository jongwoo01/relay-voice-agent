import type { SqlClientLike } from "./postgres-client.js";
import type { StoredEncryptedSecret } from "../security/secret-encryption.js";
import { normalizePostgresTimestamp } from "./postgres-value-normalizer.js";

export interface UserApiCredentialRecord {
  userId: string;
  provider: "gemini_developer_api";
  encryptedPayload: StoredEncryptedSecret;
  keyLabel?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserApiCredentialRepository {
  getActiveByUserId(
    userId: string,
    provider: UserApiCredentialRecord["provider"]
  ): Promise<UserApiCredentialRecord | null>;
  save(record: UserApiCredentialRecord): Promise<void>;
}

export class InMemoryUserApiCredentialRepository
  implements UserApiCredentialRepository
{
  private readonly records = new Map<string, UserApiCredentialRecord>();

  async getActiveByUserId(
    userId: string,
    provider: UserApiCredentialRecord["provider"]
  ): Promise<UserApiCredentialRecord | null> {
    return this.records.get(`${userId}:${provider}`) ?? null;
  }

  async save(record: UserApiCredentialRecord): Promise<void> {
    this.records.set(`${record.userId}:${record.provider}`, record);
  }
}

export class PostgresUserApiCredentialRepository
  implements UserApiCredentialRepository
{
  constructor(private readonly sql: SqlClientLike) {}

  async getActiveByUserId(
    userId: string,
    provider: UserApiCredentialRecord["provider"]
  ): Promise<UserApiCredentialRecord | null> {
    const result = await this.sql.query<{
      user_id: string;
      provider: "gemini_developer_api";
      encrypted_payload: StoredEncryptedSecret;
      key_label: string | null;
      is_active: boolean;
      created_at: string | Date;
      updated_at: string | Date;
    }>(
      `
        select
          user_id,
          provider,
          encrypted_payload,
          key_label,
          is_active,
          created_at,
          updated_at
        from user_api_credentials
        where user_id = $1
          and provider = $2
          and is_active = true
        limit 1
      `,
      [userId, provider]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      provider: row.provider,
      encryptedPayload: row.encrypted_payload,
      keyLabel: row.key_label ?? undefined,
      isActive: row.is_active,
      createdAt: normalizePostgresTimestamp(row.created_at)!,
      updatedAt: normalizePostgresTimestamp(row.updated_at)!
    };
  }

  async save(record: UserApiCredentialRecord): Promise<void> {
    await this.sql.query(
      `
        insert into user_api_credentials (
          user_id,
          provider,
          encrypted_payload,
          key_label,
          is_active,
          created_at,
          updated_at
        )
        values ($1, $2, $3::jsonb, $4, $5, $6, $7)
        on conflict (user_id, provider) do update
        set
          encrypted_payload = excluded.encrypted_payload,
          key_label = excluded.key_label,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
      [
        record.userId,
        record.provider,
        JSON.stringify(record.encryptedPayload),
        record.keyLabel ?? null,
        record.isActive,
        record.createdAt,
        record.updatedAt
      ]
    );
  }
}
