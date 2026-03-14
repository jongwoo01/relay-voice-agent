import { loadDotEnvFromRoot } from "./modules/config/env-loader.js";
import { createPostgresPool } from "./modules/persistence/postgres-client.js";
import { PostgresUserRepository } from "./modules/persistence/user-repository.js";
import { createAgentServer } from "./server/create-agent-server.js";

loadDotEnvFromRoot();

const port = Number(process.env.PORT || "8080");
const databaseUrl = process.env.DATABASE_URL?.trim();
const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT?.trim();
const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION?.trim();
const liveApiKey =
  process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
const judgePasscode = process.env.JUDGE_PASSCODE?.trim();
const judgeTokenSecret =
  process.env.JUDGE_TOKEN_SECRET?.trim() || process.env.JUDGE_PASSCODE?.trim();
const judgeUserEmail =
  process.env.JUDGE_USER_EMAIL?.trim() || "judge@gemini-live-agent.local";
const judgeUserDisplayName =
  process.env.JUDGE_USER_DISPLAY_NAME?.trim() || "Judge";
const judgeSessionTtlSeconds = Number(
  process.env.JUDGE_SESSION_TTL_SECONDS || "21600"
);

if (!judgePasscode) {
  throw new Error("JUDGE_PASSCODE is required");
}

if (!judgeTokenSecret) {
  throw new Error("JUDGE_TOKEN_SECRET or JUDGE_PASSCODE is required");
}

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the hosted Cloud Run path. In-memory persistence is not allowed here."
  );
}

if (!googleCloudProject) {
  throw new Error("GOOGLE_CLOUD_PROJECT is required for the hosted Cloud Run path");
}

if (!googleCloudLocation) {
  throw new Error("GOOGLE_CLOUD_LOCATION is required for the hosted Cloud Run path");
}

if (!liveApiKey) {
  throw new Error(
    "GEMINI_API_KEY or GOOGLE_API_KEY is required for the hosted live session"
  );
}

const sql = createPostgresPool();
const userRepository = new PostgresUserRepository(sql);
const { server } = createAgentServer({
  port,
  sql,
  userRepository,
  judgePasscode,
  judgeTokenSecret,
  judgeUserEmail,
  judgeUserDisplayName,
  judgeSessionTtlSeconds
});

async function bootstrap(): Promise<void> {
  await sql.query("select 1");

  server.listen(port, () => {
    console.log(
      `[agent-api] listening on :${port} (project=${googleCloudProject}, location=${googleCloudLocation})`
    );
  });
}

void bootstrap().catch((error) => {
  console.error(
    `[agent-api] failed to start: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
});
