import { loadDotEnvFromRoot } from "./modules/config/env-loader.js";
import { createPostgresPool } from "./modules/persistence/postgres-client.js";
import { runPostgresMigrations } from "./modules/persistence/postgres-migrator.js";

loadDotEnvFromRoot();

async function main(): Promise<void> {
  const sql = createPostgresPool();
  try {
    const applied = await runPostgresMigrations(sql);
    console.log(
      `[agent-api] applied ${applied.length} migrations: ${applied
        .map((migration) => migration.name)
        .join(", ")}`
    );
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error(
    `[agent-api] migration failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
});
