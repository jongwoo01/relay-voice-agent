import { spawn } from "node:child_process";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio
} from "node:child_process";
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
      });

      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", reject);
      child.on("close", (exitCode) => {
        lineWork
          .then(async () => {
            if (stdoutBuffer.trim()) {
              await Promise.resolve(options?.onStdoutLine?.(stdoutBuffer.trim()));
            }

            resolve({
              stdout,
              stderr,
              exitCode
            });
          })
          .catch(reject);
      });
    });
}

export const defaultExecFile = createSpawnRunner();

function buildGeminiCliEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    // Force the CLI toward cached Google OAuth auth instead of inheriting
    // live-session API key / Vertex configuration from the desktop process.
    GOOGLE_GENAI_USE_GCA: "true"
  };

  delete nextEnv.GEMINI_API_KEY;
  delete nextEnv.GOOGLE_API_KEY;
  delete nextEnv.GOOGLE_GENAI_USE_VERTEXAI;
  delete nextEnv.GOOGLE_CLOUD_PROJECT;
  delete nextEnv.GOOGLE_CLOUD_PROJECT_ID;
  delete nextEnv.GOOGLE_CLOUD_LOCATION;

  return nextEnv;
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
        streamedEvents.push(event);
        await this.onRawEvent?.(event);

        const progressEvent = toExecutorProgressEvent(
          request.task.id,
          request.now,
          event
        );

        if (progressEvent && onProgress) {
          await onProgress(progressEvent);
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
