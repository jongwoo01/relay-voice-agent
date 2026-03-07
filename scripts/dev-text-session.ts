import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { FinalizedUtterance } from "@agent/shared-types";
import {
  createPostgresSessionPersistence,
  GeminiCliExecutor,
  HeuristicIntentResolver,
  MockExecutor,
  TextRealtimeSessionLoop
} from "../apps/agent-api/src/index.ts";
const intentResolver = new HeuristicIntentResolver();

async function parseUtterance(
  line: string,
  now: string
): Promise<FinalizedUtterance | null> {
  if (!line.trim()) {
    return null;
  }

  if (line.startsWith("/task ")) {
    return {
      text: line.slice(6).trim(),
      intent: "task_request",
      createdAt: now
    };
  }

  if (line.startsWith("/chat ")) {
    return {
      text: line.slice(6).trim(),
      intent: "small_talk",
      createdAt: now
    };
  }

  if (line.startsWith("/ask ")) {
    return {
      text: line.slice(5).trim(),
      intent: "question",
      createdAt: now
    };
  }

  if (line.startsWith("/unclear ")) {
    return {
      text: line.slice(9).trim(),
      intent: "unclear",
      createdAt: now
    };
  }

  return {
    text: line,
    intent: await intentResolver.resolve(line),
    createdAt: now
  };
}

function printHelp() {
  console.log("Commands:");
  console.log("  /help                 Show help");
  console.log("  /tasks                List active tasks");
  console.log("  /messages             Show conversation log");
  console.log("  /events <taskId>      Show events for a task");
  console.log("  /wait                 Wait for background tasks to finish");
  console.log("  /quit                 Exit");
  console.log("  /task <text>          Force task intent");
  console.log("  /chat <text>          Force small-talk intent");
  console.log("  /ask <text>           Force question intent");
  console.log("  /unclear <text>       Force unclear intent");
  console.log("  plain text            Auto-infer intent");
  console.log("");
  console.log("Options:");
  console.log("  --gemini              Use Gemini CLI executor");
  console.log("  --postgres            Use Postgres-backed persistence");
  console.log("");
  console.log("Environment for --postgres:");
  console.log("  DATABASE_URL          Postgres connection string");
  console.log("  DEV_USER_ID           Existing user id to own the brain session");
}

async function main() {
  const useGeminiExecutor =
    process.argv.includes("--gemini") || process.env.GEMINI_EXECUTOR === "1";
  const usePostgresPersistence =
    process.argv.includes("--postgres") || process.env.DEV_POSTGRES === "1";
  const executor = useGeminiExecutor ? new GeminiCliExecutor() : new MockExecutor();
  const rl = createInterface({ input, output });
  const brainSessionId = `dev-session-${Date.now()}`;
  const now = new Date().toISOString();

  const persistence = usePostgresPersistence
    ? await createPostgresSessionPersistence({
        ensureBrainSession: {
          brainSessionId,
          userId:
            process.env.DEV_USER_ID ??
            (() => {
              throw new Error(
                "Set DEV_USER_ID when using --postgres for dev:text-session"
              );
            })(),
          source: "text_dev",
          now
        }
      })
    : undefined;
  const loop = new TextRealtimeSessionLoop(executor, persistence);

  const handleCommand = async (rawLine: string): Promise<boolean> => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      return true;
    }

    if (trimmed === "/quit") {
      return false;
    }

    if (trimmed === "/help") {
      printHelp();
      return true;
    }

    if (trimmed === "/tasks") {
      const tasks = await loop.listActiveTasks(brainSessionId);
      console.log(JSON.stringify(tasks, null, 2));
      return true;
    }

    if (trimmed === "/messages") {
      const messages = await loop.listConversation(brainSessionId);
      console.log(JSON.stringify(messages, null, 2));
      return true;
    }

    if (trimmed.startsWith("/events ")) {
      const taskId = trimmed.slice(8).trim();
      const events = await loop.listTaskEvents(taskId);
      console.log(JSON.stringify(events, null, 2));
      return true;
    }

    if (trimmed === "/wait") {
      await loop.waitForBackgroundWork();
      console.log("[dev] background work finished");
      return true;
    }

    const now = new Date().toISOString();
    const utterance = await parseUtterance(trimmed, now);
    if (!utterance) {
      return true;
    }

    const result = await loop.handleTurn({
      brainSessionId,
      utterance,
      now
    });

    console.log(`[assistant/${result.assistant.tone}] ${result.assistant.text}`);

    if (result.task) {
      console.log(
        `[task] id=${result.task.id} status=${result.task.status} title=${result.task.title}`
      );
    }

    return true;
  };

  console.log(
    `[dev] text session started (${useGeminiExecutor ? "gemini" : "mock"} executor, ${usePostgresPersistence ? "postgres" : "in-memory"} persistence)`
  );
  console.log(`[dev] brainSessionId=${brainSessionId}`);
  printHelp();

  if (!input.isTTY) {
    for await (const line of rl) {
      const shouldContinue = await handleCommand(line);
      if (!shouldContinue) {
        break;
      }
    }
  } else {
    while (true) {
      const line = await rl.question("> ");
      const shouldContinue = await handleCommand(line);
      if (!shouldContinue) {
        break;
      }
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error("[dev] failed:", error);
  process.exitCode = 1;
});
