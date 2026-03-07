import type { SqlClientLike } from "./postgres-client.js";

export interface UserRecord {
  id: string;
  email: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRepository {
  getById(userId: string): Promise<UserRecord | null>;
  getByEmail(email: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>();

  async getById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    return (
      Array.from(this.users.values()).find((user) => user.email === email) ?? null
    );
  }

  async create(user: UserRecord): Promise<void> {
    this.users.set(user.id, user);
  }
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: SqlClientLike) {}

  async getById(userId: string): Promise<UserRecord | null> {
    const result = await this.sql.query<{
      id: string;
      email: string;
      display_name: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, email, display_name, created_at, updated_at
        from users
        where id = $1
      `,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.sql.query<{
      id: string;
      email: string;
      display_name: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, email, display_name, created_at, updated_at
        from users
        where email = $1
      `,
      [email]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async create(user: UserRecord): Promise<void> {
    await this.sql.query(
      `
        insert into users (
          id,
          email,
          display_name,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5)
      `,
      [user.id, user.email, user.displayName ?? null, user.createdAt, user.updatedAt]
    );
  }
}
