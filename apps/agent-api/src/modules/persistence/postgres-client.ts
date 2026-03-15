import { Pool, type PoolConfig } from "pg";

export interface SqlQueryResult<Row = unknown> {
  rows: Row[];
}

export interface SqlClientLike {
  query<Row = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<Row>>;
}

export interface PostgresConnectionOptions {
  connectionString?: string;
  ssl?: PoolConfig["ssl"];
}

export interface PostgresEnvironment {
  DATABASE_URL?: string;
  PGHOST?: string;
  PGPORT?: string;
  PGUSER?: string;
  PGPASSWORD?: string;
  PGDATABASE?: string;
}

export function hasPostgresConnectionConfig(
  env: PostgresEnvironment = process.env
): boolean {
  if (env.DATABASE_URL?.trim()) {
    return true;
  }

  return Boolean(
    env.PGHOST?.trim() && env.PGUSER?.trim() && env.PGDATABASE?.trim()
  );
}

export function resolvePostgresPoolConfig(
  options: PostgresConnectionOptions = {},
  env: PostgresEnvironment = process.env
): PoolConfig {
  const connectionString = options.connectionString ?? env.DATABASE_URL?.trim();

  if (connectionString) {
    return {
      connectionString,
      ssl: options.ssl
    };
  }

  const host = env.PGHOST?.trim();
  const user = env.PGUSER?.trim();
  const database = env.PGDATABASE?.trim();

  if (!host || !user || !database) {
    throw new Error(
      "DATABASE_URL or PGHOST/PGUSER/PGDATABASE is required to create a Postgres pool"
    );
  }

  const config: PoolConfig = {
    host,
    user,
    database,
    ssl: options.ssl
  };

  if (env.PGPASSWORD) {
    config.password = env.PGPASSWORD;
  }

  if (env.PGPORT?.trim()) {
    const parsedPort = Number(env.PGPORT);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      throw new Error("PGPORT must be a positive integer when provided");
    }
    config.port = parsedPort;
  }

  return config;
}

export function createPostgresPool(
  options: PostgresConnectionOptions = {},
  env: PostgresEnvironment = process.env
): Pool {
  return new Pool(resolvePostgresPoolConfig(options, env));
}
