import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_A = 20488412;
const MIGRATION_LOCK_B = 3152026;

export interface MigrationRecord {
  name: string;
  checksum: string;
  appliedAt: string;
}

interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

interface MigrationDefinition {
  required: boolean;
  probeSql?: string;
}

const MIGRATION_DEFINITIONS: Record<string, MigrationDefinition> = {
  "0001_initial.sql": {
    required: true,
    probeSql: `
      select case
        when to_regclass('public.users') is not null
         and to_regclass('public.user_identities') is not null
         and to_regclass('public.brain_sessions') is not null
         and to_regclass('public.tasks') is not null
         and to_regclass('public.task_events') is not null
        then true
        else false
      end as applied
    `
  },
  "0002_memory_embeddings_optional.sql": {
    required: false,
    probeSql: `
      select case
        when exists (
          select 1
          from information_schema.columns
          where table_name = 'memory_items'
            and column_name = 'embedding'
        )
        then true
        else false
      end as applied
    `
  },
  "0003_task_intake_sessions.sql": {
    required: true,
    probeSql: `
      select case
        when to_regclass('public.task_intake_sessions') is not null
         and exists (
           select 1
           from information_schema.columns
           where table_name = 'tasks'
             and column_name = 'status'
         )
        then true
        else false
      end as applied
    `
  },
  "0004_task_completion_report.sql": {
    required: true,
    probeSql: `
      select case
        when exists (
          select 1
          from information_schema.columns
          where table_name = 'tasks'
            and column_name = 'completion_report_json'
        )
        then true
        else false
      end as applied
    `
  },
  "0005_session_memory_items.sql": {
    required: true,
    probeSql: `
      select case
        when to_regclass('public.session_memory_items') is not null
        then true
        else false
      end as applied
    `
  }
};

function resolveMigrationsDirectory(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../../../../db/migrations");
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = resolveMigrationsDirectory();
  const entries = await readdir(migrationsDir, {
    withFileTypes: true
  });

  const files = entries
    .filter((entry) => entry.isFile() && /^\d+_.*\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(resolve(migrationsDir, name), "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex")
      };
    })
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function recordMigration(
  client: PoolClient,
  migration: MigrationFile
): Promise<void> {
  await client.query(
    `
      insert into schema_migrations (name, checksum, applied_at)
      values ($1, $2, now())
      on conflict (name) do update
      set checksum = excluded.checksum,
          applied_at = schema_migrations.applied_at
    `,
    [migration.name, migration.checksum]
  );
}

async function probeMigrationApplied(
  client: PoolClient,
  migration: MigrationFile
): Promise<boolean> {
  const definition = MIGRATION_DEFINITIONS[migration.name];
  if (!definition?.probeSql) {
    return false;
  }

  const result = await client.query<{ applied: boolean }>(definition.probeSql);
  return result.rows[0]?.applied === true;
}

function isRequiredMigration(migration: MigrationFile): boolean {
  return MIGRATION_DEFINITIONS[migration.name]?.required !== false;
}

async function listAppliedMigrations(client: PoolClient): Promise<MigrationRecord[]> {
  const result = await client.query<{
    name: string;
    checksum: string;
    applied_at: string | Date;
  }>(`
    select
      name,
      checksum,
      applied_at
    from schema_migrations
    order by name asc
  `);

  return result.rows.map((row) => ({
    name: row.name,
    checksum: row.checksum,
    appliedAt:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : new Date(row.applied_at).toISOString()
  }));
}

export async function runPostgresMigrations(sql: Pool): Promise<MigrationRecord[]> {
  const migrationFiles = await loadMigrationFiles();
  const client = await sql.connect();

  try {
    await client.query("select pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK_A,
      MIGRATION_LOCK_B
    ]);
    await ensureMigrationTable(client);

    const applied = new Map(
      (await listAppliedMigrations(client)).map((migration) => [
        migration.name,
        migration
      ])
    );

    for (const migration of migrationFiles) {
      const existing = applied.get(migration.name);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch for ${migration.name}. The applied migration does not match the file on disk.`
          );
        }
        continue;
      }

      if (await probeMigrationApplied(client, migration)) {
        await recordMigration(client, migration);
        applied.set(migration.name, {
          name: migration.name,
          checksum: migration.checksum,
          appliedAt: new Date().toISOString()
        });
        continue;
      }

      if (!isRequiredMigration(migration)) {
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await recordMigration(client, migration);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    return listAppliedMigrations(client);
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1, $2)", [
        MIGRATION_LOCK_A,
        MIGRATION_LOCK_B
      ]);
    } finally {
      client.release();
    }
  }
}

export async function assertPostgresSchemaUpToDate(sql: Pool): Promise<void> {
  const migrationFiles = await loadMigrationFiles();
  const client = await sql.connect();

  try {
    const existsResult = await client.query<{ exists: string | null }>(
      "select to_regclass('public.schema_migrations') as exists"
    );
    if (!existsResult.rows[0]?.exists) {
      throw new Error(
        "Database schema is not initialized. Run `npm run db:migrate --workspace @agent/agent-api` before starting the server."
      );
    }

    const applied = new Map(
      (await listAppliedMigrations(client)).map((migration) => [
        migration.name,
        migration
      ])
    );

    const pending = migrationFiles.filter(
      (migration) => isRequiredMigration(migration) && !applied.has(migration.name)
    );
    if (pending.length > 0) {
      throw new Error(
        `Database schema is out of date. Pending migrations: ${pending
          .map((migration) => migration.name)
          .join(", ")}. Run \`npm run db:migrate --workspace @agent/agent-api\`.`
      );
    }

    for (const migration of migrationFiles) {
      const existing = applied.get(migration.name);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(
          `Database migration drift detected for ${migration.name}. The applied checksum does not match the file on disk.`
        );
      }
    }
  } finally {
    client.release();
  }
}
