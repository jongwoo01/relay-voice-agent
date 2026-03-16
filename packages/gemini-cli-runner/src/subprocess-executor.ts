import { spawn } from "node:child_process";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio
} from "node:child_process";
import { delimiter } from "node:path";
import { homedir } from "node:os";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  ExecutorProgressListener,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { buildGeminiCliCommand } from "./command-builder.js";
import {
  buildExecutorResultFromGeminiCliOutput,
  parseGeminiCliEventLine,
  parseGeminiCliOutput,
  toExecutorProgressEvent,
  type GeminiCliHeadlessEvent
} from "./output-parser.js";

export type GeminiCliRawEventListener = (
  event: GeminiCliHeadlessEvent
) => void | Promise<void>;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdoutLine?: (line: string) => void | Promise<void>;
}

export type SpawnLike = (
  file: string,
  args: string[],
  options?: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type RunCommandLike = (
  file: string,
  args: string[],
  options?: RunCommandOptions
) => Promise<ExecResult>;

function flushLines(
  buffer: string,
  onLine?: (line: string) => void | Promise<void>
): { rest: string; lines: string[] } {
  const readyLines: string[] = [];
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    if (onLine) {
      readyLines.push(line);
    }
  }

  return { rest, lines: readyLines };
}

export function createSpawnRunner(
  spawnCommand: SpawnLike = spawn
): RunCommandLike {
  return async (
    file: string,
    args: string[],
    options?: RunCommandOptions
  ): Promise<ExecResult> =>
    await new Promise<ExecResult>((resolve, reject) => {
      const child = spawnCommand(file, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: "pipe"
      });

      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let lineWork = Promise.resolve();
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore kill failures during shutdown.
        }
        reject(error);
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        stdoutBuffer += chunk;
        const flushed = flushLines(stdoutBuffer, options?.onStdoutLine);
        stdoutBuffer = flushed.rest;
        lineWork = lineWork.then(async () => {
          for (const line of flushed.lines) {
            await options?.onStdoutLine?.(line);
          }
        });
        lineWork.catch(fail);
      });

      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", fail);
      child.on("close", (exitCode) => {
        if (settled) {
          return;
        }
        lineWork
          .then(async () => {
            if (stdoutBuffer.trim()) {
              await Promise.resolve(options?.onStdoutLine?.(stdoutBuffer.trim()));
            }

            if (settled) {
              return;
            }
            settled = true;
            resolve({
              stdout,
              stderr,
              exitCode
            });
          })
          .catch(fail);
      });
    });
}

export const defaultExecFile = createSpawnRunner();

export function buildGeminiCliEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const homeDirectory = homedir();
  const additionalPathEntries =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", `${homeDirectory}/.local/bin`]
      : process.platform === "win32"
        ? [
            `${env.APPDATA ?? ""}\\npm`,
            `${env.USERPROFILE ?? ""}\\AppData\\Roaming\\npm`
          ]
        : ["/usr/local/bin", `${homeDirectory}/.local/bin`];
  const currentPath = env.PATH?.split(delimiter).filter(Boolean) ?? [];
  const mergedPath = [...additionalPathEntries, ...currentPath].filter(Boolean);
  const dedupedPath = [...new Set(mergedPath)];
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    // Force the CLI toward cached Google OAuth auth instead of inheriting
    // live-session API key / Vertex configuration from the desktop process.
    GOOGLE_GENAI_USE_GCA: "true",
    PATH: dedupedPath.join(delimiter)
  };

  delete nextEnv.GEMINI_API_KEY;
  delete nextEnv.GOOGLE_API_KEY;
  delete nextEnv.GOOGLE_GENAI_USE_VERTEXAI;
  delete nextEnv.GOOGLE_CLOUD_PROJECT;
  delete nextEnv.GOOGLE_CLOUD_PROJECT_ID;
  delete nextEnv.GOOGLE_CLOUD_LOCATION;

  return nextEnv;
}

function collectEventText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectEventText(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectEventText(item));
  }

  return [];
}

function detectTerminalFailure(event: GeminiCliHeadlessEvent): string | null {
  const combined = collectEventText(event.payload)
    .join("\n")
    .toLowerCase();

  if (!combined) {
    return null;
  }

  if (
    combined.includes("insufficient authentication scopes") ||
    combined.includes("insufficient permission") ||
    combined.includes("permission denied")
  ) {
    return "Task failed: required authentication or permission is missing.";
  }

  if (
    combined.includes("undelivered mail retu") ||
    combined.includes("undelivered mail returned") ||
    (combined.includes("mailer-daemon") && combined.includes("undelivered"))
  ) {
    return "Task failed: the attempted email delivery bounced.";
  }

  if (
    combined.includes("delivery failure") ||
    combined.includes("delivery status report")
  ) {
    return "Task failed: email delivery could not be confirmed.";
  }

  return null;
}

export class GeminiCliExecutor implements LocalExecutor {
  constructor(
    private readonly exec: RunCommandLike = defaultExecFile,
    private readonly onRawEvent?: GeminiCliRawEventListener
  ) {}

  async run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    const command = buildGeminiCliCommand(request);
    const streamedEvents: GeminiCliHeadlessEvent[] = [];

    const result = await this.exec(command.command, command.args, {
      cwd: command.cwd,
      env: buildGeminiCliEnvironment(),
      onStdoutLine: async (line) => {
        const event = parseGeminiCliEventLine(line);
        const contextualEvent: GeminiCliHeadlessEvent = {
          ...event,
          payload: {
            ...event.payload,
            taskId: request.task.id
          }
        };
        streamedEvents.push(contextualEvent);
        await this.onRawEvent?.(contextualEvent);

        const progressEvent = toExecutorProgressEvent(
          request.task.id,
          request.now,
          contextualEvent
        );

        if (progressEvent && onProgress) {
          await onProgress(progressEvent);
        }

        const terminalFailure = detectTerminalFailure(contextualEvent);
        if (terminalFailure) {
          throw new Error(terminalFailure);
        }
      }
    });

    const parsed =
      streamedEvents.length > 0
        ? { events: streamedEvents }
        : parseGeminiCliOutput(result.stdout);

    return buildExecutorResultFromGeminiCliOutput({
      taskId: request.task.id,
      now: request.now,
      output: parsed
    });
  }
}
