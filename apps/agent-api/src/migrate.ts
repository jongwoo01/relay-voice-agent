import { loadDotEnvFromRoot } from "./modules/config/env-loader.js";
import { createPostgresPool } from "./modules/persistence/postgres-client.js";
import { runPostgresMigrations } from "./modules/persistence/postgres-migrator.js";

loadDotEnvFromRoot();

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const details: string[] = [];
    const name = error.name?.trim();
    const message = error.message?.trim();

    if (name && message) {
      details.push(`${name}: ${message}`);
    } else if (message) {
      details.push(message);
    } else if (name) {
      details.push(name);
    }

    const pgCode = (error as { code?: unknown }).code;
    if (typeof pgCode === "string" && pgCode.trim()) {
      details.push(`code=${pgCode}`);
    }

    const pgDetail = (error as { detail?: unknown }).detail;
    if (typeof pgDetail === "string" && pgDetail.trim()) {
      details.push(`detail=${pgDetail}`);
    }

    if (error.stack?.trim()) {
      details.push(error.stack);
    }

    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      details.push(`cause: ${formatUnknownError(cause)}`);
    }

    if (details.length > 0) {
      return details.join("\n");
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

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
  console.error(`[agent-api] migration failed:\n${formatUnknownError(error)}`);
  process.exit(1);
});
