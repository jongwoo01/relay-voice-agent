import { loadDotEnvFromRoot } from "../apps/agent-api/src/index.ts";
import { DesktopSessionRuntime } from "../apps/desktop/src/main/session/desktop-session-runtime.js";

loadDotEnvFromRoot();

function parseArgs(argv: string[]) {
  const showRawExecutor =
    argv.includes("--raw-executor") || process.env.DEV_RAW_EXECUTOR === "1";
  const inferIntent = argv.includes("--infer-intent");
  const useMockExecutor =
    argv.includes("--mock") || process.env.DESKTOP_EXECUTOR === "mock";
  const utterances = argv.filter((arg) => !arg.startsWith("--"));

  return {
    showRawExecutor,
    inferIntent,
    executionMode: useMockExecutor ? "mock" : "gemini",
    utterances:
      utterances.length > 0
        ? utterances
        : ["아무 도구도 쓰지 말고 READY 한 단어만 답해줘"]
  };
}

function summarizeTaskTimelines(taskTimelines: Array<{
  taskId: string;
  events: Array<{ type: string; message: string }>;
}>) {
  return taskTimelines.map((timeline) => ({
    taskId: timeline.taskId,
    latestEvent: timeline.events.at(-1) ?? null,
    eventCount: timeline.events.length
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stateUpdates: Array<{
    input: {
      inFlight: boolean;
      queueSize: number;
      activeText: string | null;
      lastError: string | null;
    };
    pendingBriefingCount: number;
    messageCount: number;
    taskCount: number;
  }> = [];
  let lastSeenTaskTimelines: Array<{
    taskId: string;
    latestEvent: { type: string; message: string } | null;
    eventCount: number;
  }> = [];

  const runtime = DesktopSessionRuntime.create({
    executionMode: options.executionMode,
    intentResolver: options.inferIntent
      ? undefined
      : {
          resolve: async () => "task_request"
        },
    onRawExecutorEvent: options.showRawExecutor
      ? async (event) => {
          console.log(`[executor/raw] ${JSON.stringify(event)}`);
        }
      : undefined,
    onStateChange: async (state) => {
      if (state.taskTimelines.length > 0) {
        lastSeenTaskTimelines = summarizeTaskTimelines(state.taskTimelines);
      }

      stateUpdates.push({
        input: state.input,
        pendingBriefingCount: state.pendingBriefingCount,
        messageCount: state.messages.length,
        taskCount: state.tasks.length
      });
    }
  });

  await runtime.init();

  console.log(
    `[smoke] desktop runtime started (${options.executionMode} executor)`
  );

  for (const utterance of options.utterances) {
    console.log(`[user] ${utterance}`);
    await runtime.sendText(utterance);
  }

  const finalState = await runtime.waitForIdle();

  console.log("[smoke] final summary:");
  console.log(
    JSON.stringify(
      {
        executionMode: finalState.executionMode,
        messageCount: finalState.messages.length,
        taskCount: finalState.tasks.length,
        deliveredBriefings: finalState.notifications.delivered.length,
        pendingBriefings: finalState.notifications.pending.length,
        latestMessages: finalState.messages.slice(-4),
        taskTimelines:
          finalState.taskTimelines.length > 0
            ? summarizeTaskTimelines(finalState.taskTimelines)
            : lastSeenTaskTimelines,
        input: finalState.input,
        rawExecutorEventCount:
          finalState.debug?.rawExecutorEvents?.length ?? 0,
        stateUpdateCount: stateUpdates.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exitCode = 1;
});
