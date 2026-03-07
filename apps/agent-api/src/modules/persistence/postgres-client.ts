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

export function createPostgresPool(
  options: PostgresConnectionOptions = {}
): Pool {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a Postgres pool");
  }

  return new Pool({
    connectionString,
    ssl: options.ssl
  });
}
