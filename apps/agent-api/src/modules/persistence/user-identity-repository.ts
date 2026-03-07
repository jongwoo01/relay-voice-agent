import type { SqlClientLike } from "./postgres-client.js";

export interface UserIdentityRecord {
  userId: string;
  provider: "google";
  providerUserId: string;
  email?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserIdentityRepository {
  getByProviderIdentity(
    provider: UserIdentityRecord["provider"],
    providerUserId: string
  ): Promise<UserIdentityRecord | null>;
  save(identity: UserIdentityRecord): Promise<void>;
}

export class InMemoryUserIdentityRepository implements UserIdentityRepository {
  private readonly identities = new Map<string, UserIdentityRecord>();

  async getByProviderIdentity(
    provider: UserIdentityRecord["provider"],
    providerUserId: string
  ): Promise<UserIdentityRecord | null> {
    return this.identities.get(`${provider}:${providerUserId}`) ?? null;
  }

  async save(identity: UserIdentityRecord): Promise<void> {
    this.identities.set(
      `${identity.provider}:${identity.providerUserId}`,
      identity
    );
  }
}

export class PostgresUserIdentityRepository implements UserIdentityRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async getByProviderIdentity(
    provider: UserIdentityRecord["provider"],
    providerUserId: string
  ): Promise<UserIdentityRecord | null> {
    const result = await this.sql.query<{
      user_id: string;
      provider: "google";
      provider_user_id: string;
      email: string | null;
      email_verified: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `
        select
          user_id,
          provider,
          provider_user_id,
          email,
          email_verified,
          created_at,
          updated_at
        from user_identities
        where provider = $1 and provider_user_id = $2
      `,
      [provider, providerUserId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      email: row.email ?? undefined,
      emailVerified: row.email_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async save(identity: UserIdentityRecord): Promise<void> {
    await this.sql.query(
      `
        insert into user_identities (
          user_id,
          provider,
          provider_user_id,
          email,
          email_verified,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (provider, provider_user_id) do update
        set
          user_id = excluded.user_id,
          email = excluded.email,
          email_verified = excluded.email_verified,
          updated_at = excluded.updated_at
      `,
      [
        identity.userId,
        identity.provider,
        identity.providerUserId,
        identity.email ?? null,
        identity.emailVerified,
        identity.createdAt,
        identity.updatedAt
      ]
    );
  }
}
