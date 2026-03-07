import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { FinalizedUtterance, IntentType } from "@agent/shared-types";
import { GeminiCliExecutor, MockExecutor, TextRealtimeSessionLoop } from "../apps/agent-api/src/index.ts";

function inferIntent(text: string): IntentType {
  const normalized = text.trim().toLowerCase();

  if (
    normalized.includes("해줘") ||
    normalized.includes("실행") ||
    normalized.includes("정리") ||
    normalized.includes("만들어") ||
    normalized.includes("이어") ||
    normalized.includes("continue") ||
    normalized.includes("do ") ||
    normalized.includes("run ")
  ) {
    return "task_request";
  }

  if (
    normalized.includes("?") ||
    normalized.startsWith("what") ||
    normalized.startsWith("why") ||
    normalized.startsWith("how") ||
    normalized.startsWith("when") ||
    normalized.startsWith("where")
  ) {
    return "question";
  }

  return "small_talk";
}

function parseUtterance(line: string, now: string): FinalizedUtterance | null {
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
    intent: inferIntent(line),
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
}

async function main() {
  const useGeminiExecutor =
    process.argv.includes("--gemini") || process.env.GEMINI_EXECUTOR === "1";
  const executor = useGeminiExecutor ? new GeminiCliExecutor() : new MockExecutor();
  const loop = new TextRealtimeSessionLoop(executor);
  const rl = createInterface({ input, output });
  const brainSessionId = `dev-session-${Date.now()}`;

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
    const utterance = parseUtterance(trimmed, now);
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
    `[dev] text session started (${useGeminiExecutor ? "gemini" : "mock"} executor)`
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
