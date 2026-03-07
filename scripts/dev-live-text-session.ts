import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Modality } from "@google/genai";
import {
  DEFAULT_LIVE_MODEL,
  GoogleLiveApiTransport,
  loadDotEnvFromRoot,
  type GoogleLiveTransportEvent
} from "../apps/agent-api/src/index.ts";

loadDotEnvFromRoot();

function printHelp() {
  console.log("Commands:");
  console.log("  /help                 Show help");
  console.log("  /quit                 Exit");
  console.log("  /send <text>          Send a text turn with turnComplete=true");
  console.log("  /realtime <text>      Send realtime text input");
  console.log("  plain text            Same as /send");
  console.log("");
  console.log("Environment:");
  console.log("  GOOGLE_API_KEY or GEMINI_API_KEY must be set");
  console.log(`  LIVE_MODEL optional (default: ${DEFAULT_LIVE_MODEL})`);
}

function printEvent(event: GoogleLiveTransportEvent) {
  switch (event.type) {
    case "input_transcription_partial":
      console.log(`[input/partial] ${event.text}`);
      break;
    case "input_transcription_final":
      console.log(`[input/final] ${event.text}`);
      if (event.turn?.assistant) {
        console.log(
          `[brain/${event.turn.assistant.tone}] ${event.turn.assistant.text}`
        );
      }
      if (event.turn?.task) {
        console.log(
          `[brain/task] id=${event.turn.task.id} status=${event.turn.task.status} title=${event.turn.task.title}`
        );
      }
      break;
    case "model_text":
      console.log(`[model/text] ${event.text}`);
      break;
    case "output_transcription":
      console.log(
        `[model/transcript${event.finished ? "/final" : ""}] ${event.text}`
      );
      break;
    case "waiting_for_input":
      console.log("[session] waiting for input");
      break;
    case "turn_complete":
      console.log("[session] turn complete");
      break;
    case "interrupted":
      console.log("[session] interrupted");
      break;
    case "go_away":
      console.log(
        `[session] go-away${event.timeLeft ? ` timeLeft=${event.timeLeft}` : ""}`
      );
      break;
  }
}

function normalizeCommand(line: string): {
  type: "quit" | "help" | "send" | "realtime";
  text?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === "/quit") {
    return { type: "quit" };
  }

  if (trimmed === "/help") {
    return { type: "help" };
  }

  if (trimmed.startsWith("/send ")) {
    return { type: "send", text: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith("/realtime ")) {
    return { type: "realtime", text: trimmed.slice(10).trim() };
  }

  return { type: "send", text: trimmed };
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set GOOGLE_API_KEY or GEMINI_API_KEY before running dev:live-text-session"
    );
  }

  const model = process.env.LIVE_MODEL ?? DEFAULT_LIVE_MODEL;
  const brainSessionId = `live-session-${Date.now()}`;
  const rl = createInterface({ input, output });
  const transport = new GoogleLiveApiTransport();

  const session = await transport.connect({
    apiKey,
    brainSessionId,
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {}
    },
    callbacks: {
      onopen: () => {
        console.log(`[live] connected model=${model}`);
      },
      onclose: (info) => {
        const extras = [
          info.code !== undefined ? `code=${info.code}` : undefined,
          info.reason ? `reason=${info.reason}` : undefined,
          info.wasClean !== undefined ? `clean=${info.wasClean}` : undefined
        ].filter(Boolean);
        console.log(
          `[live] closed${extras.length > 0 ? ` (${extras.join(" ")})` : ""}`
        );
      },
      onerror: (error) => {
        console.error("[live] error:", error);
      },
      onevent: async (event) => {
        printEvent(event);
      }
    }
  });

  console.log(`[live] brainSessionId=${brainSessionId}`);
  printHelp();

  try {
    if (!input.isTTY) {
      for await (const line of rl) {
        const command = normalizeCommand(line);
        if (!command) {
          continue;
        }

        if (command.type === "quit") {
          break;
        }

        if (command.type === "help") {
          printHelp();
          continue;
        }

        if (!command.text) {
          continue;
        }

        if (command.type === "send") {
          session.sendText(command.text, true);
        } else {
          session.sendRealtimeText(command.text);
        }
      }
      return;
    }

    while (true) {
      const line = await rl.question("> ");
      const command = normalizeCommand(line);
      if (!command) {
        continue;
      }

      if (command.type === "quit") {
        break;
      }

      if (command.type === "help") {
        printHelp();
        continue;
      }

      if (!command.text) {
        continue;
      }

      if (command.type === "send") {
        session.sendText(command.text, true);
      } else {
        session.sendRealtimeText(command.text);
      }
    }
  } finally {
    rl.close();
    session.close();
  }
}

main().catch((error) => {
  console.error("[live] failed:", error);
  process.exitCode = 1;
});
