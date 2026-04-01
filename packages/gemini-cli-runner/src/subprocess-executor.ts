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
import { resolvePlatformSpawnCommand } from "./windows-spawn.js";
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
  signal?: AbortSignal;
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

export class ExecutorCancelledError extends Error {
  constructor(message = "Task execution cancelled") {
    super(message);
    this.name = "ExecutorCancelledError";
  }
}

export function isExecutorCancelledError(error: unknown): error is ExecutorCancelledError {
  return error instanceof ExecutorCancelledError;
}

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
      const platformCommand = resolvePlatformSpawnCommand({
        file,
        args,
        env: options?.env
      });
      const child = spawnCommand(platformCommand.file, platformCommand.args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: "pipe",
        windowsHide: platformCommand.windowsHide
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

      const abort = () => {
        fail(new ExecutorCancelledError());
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          abort();
          return;
        }
        options.signal.addEventListener("abort", abort, { once: true });
      }

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
  const sharedNodePathEntries =
    process.platform === "darwin"
      ? [
          "/opt/homebrew/opt/node/bin",
          "/opt/homebrew/opt/node@22/bin",
          "/opt/homebrew/opt/node@20/bin",
          "/opt/homebrew/opt/node@18/bin"
        ]
      : [];
  const additionalPathEntries =
    process.platform === "darwin"
      ? [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          `${homeDirectory}/.local/bin`,
          ...sharedNodePathEntries
        ]
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
    PATH: dedupedPath.join(delimiter)
  };

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
  private readonly abortControllersByTaskId = new Map<string, AbortController>();

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
    const unparsedStdoutLines: string[] = [];
    const abortController = new AbortController();
    this.abortControllersByTaskId.set(request.task.id, abortController);

    try {
      const result = await this.exec(command.command, command.args, {
        cwd: command.cwd,
        env: buildGeminiCliEnvironment(),
        signal: abortController.signal,
        onStdoutLine: async (line) => {
          let event: GeminiCliHeadlessEvent;
          try {
            event = parseGeminiCliEventLine(line);
          } catch {
            unparsedStdoutLines.push(line);
            return;
          }
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

      let parsed;
      try {
        parsed = parseGeminiCliOutput(result.stdout);
      } catch (error) {
        const preview = unparsedStdoutLines[0]?.trim();
        if (preview) {
          throw new Error(
            `Gemini CLI did not return usable structured output in stream-json mode. First non-JSON stdout line: "${preview}"`
          );
        }
        throw error;
      }

      return buildExecutorResultFromGeminiCliOutput({
        taskId: request.task.id,
        now: request.now,
        output: parsed
      });
    } finally {
      const activeController = this.abortControllersByTaskId.get(request.task.id);
      if (activeController === abortController) {
        this.abortControllersByTaskId.delete(request.task.id);
      }
    }
  }

  async cancel(taskId: string): Promise<boolean> {
    const controller = this.abortControllersByTaskId.get(taskId);
    if (!controller) {
      return false;
    }

    this.abortControllersByTaskId.delete(taskId);
    controller.abort();
    return true;
  }
}
