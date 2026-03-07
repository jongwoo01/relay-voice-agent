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

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunCommandOptions {
  cwd?: string;
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

export class GeminiCliExecutor implements LocalExecutor {
  constructor(private readonly exec: RunCommandLike = defaultExecFile) {}

  async run(
    request: ExecutorRunRequest,
    onProgress?: ExecutorProgressListener
  ): Promise<ExecutorRunResult> {
    const command = buildGeminiCliCommand(request);
    const streamedEvents: GeminiCliHeadlessEvent[] = [];

    const result = await this.exec(command.command, command.args, {
      cwd: command.cwd,
      onStdoutLine: async (line) => {
        const event = parseGeminiCliEventLine(line);
        streamedEvents.push(event);

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
