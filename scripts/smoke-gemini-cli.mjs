import { spawn } from "node:child_process";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Reply with the single word READY.";
const timeoutMs = Number(process.env.GEMINI_SMOKE_TIMEOUT_MS || "20000");
const mode = process.env.GEMINI_SMOKE_MODE || "both";

function summarizeEvent(event) {
  const keys = Object.keys(event).filter((key) => key !== "type");
  return {
    type: event.type,
    keys
  };
}

async function runAttempt(label, args) {
  console.log(`[smoke] running (${label}):`, ["gemini", ...args].join(" "));
  const child = spawn("gemini", args, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";
  const events = [];

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    stdoutBuffer += chunk;

    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        events.push(parsed);
      } catch (error) {
        console.log("[smoke] non-json stdout line:", trimmed);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  clearTimeout(timer);

  if (stdoutBuffer.trim()) {
    try {
      events.push(JSON.parse(stdoutBuffer.trim()));
    } catch (error) {
      console.log("[smoke] non-json trailing stdout:", stdoutBuffer.trim());
    }
  }

  console.log(`[smoke] exit code (${label}):`, exitCode);
  console.log(`[smoke] event count (${label}):`, events.length);

  if (events.length > 0) {
    console.log(`[smoke] event summary (${label}):`);
    for (const event of events) {
      console.log(JSON.stringify(summarizeEvent(event)));
    }

    const fullEvents = process.env.GEMINI_SMOKE_FULL === "1";
    if (fullEvents) {
      console.log(`[smoke] full events (${label}):`);
      for (const event of events) {
        console.log(JSON.stringify(event, null, 2));
      }
    }
  }

  if (stderr.trim()) {
    console.log(`[smoke] stderr (${label}):`);
    console.log(stderr.trim());
  }

  if (events.length === 0 && !stderr.trim()) {
    console.log(`[smoke] no events were captured (${label}).`);
  }

  return {
    exitCode,
    events,
    stderr
  };
}

async function main() {
  const attempts =
    mode === "dash-p"
      ? [{ label: "dash-p", args: ["-p", prompt, "--output-format", "stream-json"] }]
      : mode === "positional"
        ? [{ label: "positional", args: [prompt, "--output-format", "stream-json"] }]
        : [
            {
              label: "positional",
              args: [prompt, "--output-format", "stream-json"]
            },
            {
              label: "dash-p",
              args: ["-p", prompt, "--output-format", "stream-json"]
            }
          ];

  for (const attempt of attempts) {
    await runAttempt(attempt.label, attempt.args);
  }
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exitCode = 1;
});
