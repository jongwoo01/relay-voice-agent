import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import type { ExecutorRunRequest } from "@agent/local-executor-protocol";

export interface GeminiCliCommand {
  command: string;
  args: string[];
  cwd?: string;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveGeminiCliCommand(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.GEMINI_CLI_PATH?.trim();
  if (override) {
    return override;
  }

  const homeDirectory = homedir();
  const candidatePaths =
    process.platform === "darwin"
      ? [
          "/opt/homebrew/bin/gemini",
          "/usr/local/bin/gemini",
          `${homeDirectory}/.local/bin/gemini`
        ]
      : process.platform === "win32"
        ? [
            `${env.APPDATA ?? ""}\\npm\\gemini.cmd`,
            `${env.USERPROFILE ?? ""}\\AppData\\Roaming\\npm\\gemini.cmd`
          ]
        : ["/usr/local/bin/gemini", `${homeDirectory}/.local/bin/gemini`];

  for (const candidate of candidatePaths) {
    if (candidate && isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "gemini.cmd" : "gemini";
}

const COMPLETION_REPORT_INSTRUCTIONS = [
  "You are executing a local desktop task.",
  "Perform the work conservatively and never claim a file change you did not verify yourself.",
  "If you are unsure whether a move/delete/write happened, say it is uncertain instead of claiming success.",
  "Prefer built-in directory and file tools over shell commands for inspection, counting, or listing tasks.",
  "If the user asks to read, quote, print, or transcribe a local text file, return the requested file contents directly unless the file is binary, unreadable, or the user explicitly asked for only a summary.",
  "Do not replace a direct file-content request with a summary, paraphrase, or invented privacy-policy refusal unless a tool result actually shows that limitation.",
  "For directory inspection requests, default to the immediate children of the named directory.",
  "Do not recurse into subdirectories, use ls -R, find, or other deep scans unless the user explicitly asked for recursive, nested, deep, or descendant results.",
  "Do not expand a simple listing request into a broader filesystem crawl just to be extra thorough.",
  "In the final result.response field, first write the complete natural-language answer for the user.",
  'After that, add a new line that starts with REPORT_JSON: followed by a single-line JSON object with this shape:',
  '{"summary":"string","keyFindings":["string"],"verification":"verified|uncertain","changes":["string"],"question":"string"}',
  'Keep "summary" short and useful for a card preview or spoken completion briefing, but do not omit the main requested facts when they fit in one sentence.',
  'If the user asked for exact names, IDs, paths, or other concrete items, include those facts in the natural-language answer and in "keyFindings".',
  'Use "keyFindings" for the important concrete facts that should be reusable in a follow-up answer.',
  'Use "question" only when you need user input or approval; otherwise return an empty string.',
  'Use "changes" for concrete verified actions or observations only. If nothing was verified, return an empty array.',
  "Do not wrap the JSON in markdown fences."
].join("\n");

function buildExecutorPrompt(request: ExecutorRunRequest): string {
  const locationHint = request.workingDirectory
    ? `Working directory: ${request.workingDirectory}`
    : "Working directory: current default workspace";

  return `${COMPLETION_REPORT_INSTRUCTIONS}\n\n${locationHint}\n\nUser task:\n${request.prompt}`;
}

export function buildGeminiCliCommand(
  request: ExecutorRunRequest
): GeminiCliCommand {
  const prompt = buildExecutorPrompt(request);
  const args = request.resumeSessionId
    ? [
        "-r",
        request.resumeSessionId,
        "-p",
        prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ]
    : [
        "-p",
        prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ];

  return {
    command: resolveGeminiCliCommand(),
    args,
    cwd: request.workingDirectory
  };
}
