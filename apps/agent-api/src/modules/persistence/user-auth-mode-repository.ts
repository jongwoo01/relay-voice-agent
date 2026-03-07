import type { SqlClientLike } from "./postgres-client.js";

export type UserAuthMode = "google_oauth" | "gemini_api_key";

export interface UserAuthModeRecord {
  userId: string;
  primaryMode: UserAuthMode;
  createdAt: string;
  updatedAt: string;
}

export interface UserAuthModeRepository {
  getByUserId(userId: string): Promise<UserAuthModeRecord | null>;
  save(mode: UserAuthModeRecord): Promise<void>;
}

export class InMemoryUserAuthModeRepository implements UserAuthModeRepository {
  private readonly modes = new Map<string, UserAuthModeRecord>();

  async getByUserId(userId: string): Promise<UserAuthModeRecord | null> {
    return this.modes.get(userId) ?? null;
  }

  async save(mode: UserAuthModeRecord): Promise<void> {
    this.modes.set(mode.userId, mode);
  }
}

export class PostgresUserAuthModeRepository implements UserAuthModeRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async getByUserId(userId: string): Promise<UserAuthModeRecord | null> {
    const result = await this.sql.query<{
      user_id: string;
      primary_mode: UserAuthMode;
      created_at: string;
      updated_at: string;
    }>(
      `
        select user_id, primary_mode, created_at, updated_at
        from user_auth_modes
        where user_id = $1
      `,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      primaryMode: row.primary_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async save(mode: UserAuthModeRecord): Promise<void> {
    await this.sql.query(
      `
        insert into user_auth_modes (
          user_id,
          primary_mode,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4)
        on conflict (user_id) do update
        set
          primary_mode = excluded.primary_mode,
          updated_at = excluded.updated_at
      `,
      [mode.userId, mode.primaryMode, mode.createdAt, mode.updatedAt]
    );
  }
}
