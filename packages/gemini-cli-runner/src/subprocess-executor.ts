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
  onStderrLine?: (line: string) => void | Promise<void>;
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
      let stderrBuffer = "";
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
        stderrBuffer += chunk;
        const flushed = flushLines(stderrBuffer, options?.onStderrLine);
        stderrBuffer = flushed.rest;
        lineWork = lineWork.then(async () => {
          for (const line of flushed.lines) {
            await options?.onStderrLine?.(line);
          }
        });
        lineWork.catch(fail);
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
            if (stderrBuffer.trim()) {
              await Promise.resolve(options?.onStderrLine?.(stderrBuffer.trim()));
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

const HEARTBEAT_START_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const BLOCKER_FAILURE_IDLE_MS = 90_000;
const WATCHDOG_TICK_MS = 5_000;
const DIAGNOSTIC_LINE_LIMIT = 6;

type RuntimeBlockerKind = "trust" | "approval" | "shell" | "auth" | "permission" | "quota";

interface RuntimeBlocker {
  kind: RuntimeBlockerKind;
  message: string;
}

function trimDiagnosticLine(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function rememberDiagnosticLine(target: string[], line: string) {
  const trimmed = trimDiagnosticLine(line);
  if (!trimmed) {
    return;
  }
  target.push(trimmed);
  if (target.length > DIAGNOSTIC_LINE_LIMIT) {
    target.shift();
  }
}

function detectRuntimeBlocker(line: string): RuntimeBlocker | null {
  const normalized = line.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("safe mode") ||
    normalized.includes("trusted folders") ||
    normalized.includes("trust this workspace") ||
    normalized.includes("workspace is not trusted") ||
    normalized.includes("untrusted workspace")
  ) {
    return {
      kind: "trust",
      message:
        "Gemini CLI appears to be in safe mode because this workspace is not trusted. Disable Trusted Folders or trust this workspace in Relay before retrying."
    };
  }

  if (
    normalized.includes("waiting for approval") ||
    normalized.includes("approval required") ||
    normalized.includes("approve") ||
    normalized.includes("confirm")
  ) {
    return {
      kind: "approval",
      message:
        "Gemini CLI appears to be waiting for tool approval. This is usually caused by workspace trust or an interactive approval prompt."
    };
  }

  if (
    normalized.includes("cmd.exe") ||
    normalized.includes("powershell") ||
    normalized.includes("shell command") ||
    normalized.includes("run_shell_command") ||
    normalized.includes("not recognized as an internal or external command") ||
    normalized.includes("command failed")
  ) {
    return {
      kind: "shell",
      message:
        "A Windows shell command appears to be blocked or incompatible. Relay will keep using file tools first, but this task may need a simpler command path."
    };
  }

  if (
    normalized.includes("authentication") ||
    normalized.includes("login required") ||
    normalized.includes("credentials") ||
    normalized.includes("api key")
  ) {
    return {
      kind: "auth",
      message:
        "Gemini CLI appears to be waiting on authentication or credentials. Check the current Gemini login state before retrying."
    };
  }

  if (normalized.includes("permission denied") || normalized.includes("insufficient permission")) {
    return {
      kind: "permission",
      message:
        "Local permissions appear to be blocking Gemini CLI or a requested tool. Check folder access and account permissions before retrying."
    };
  }

  if (normalized.includes("quota") || normalized.includes("rate limit")) {
    return {
      kind: "quota",
      message:
        "Gemini CLI appears to be blocked by quota or rate limiting. Retry after the local quota window resets."
    };
  }

  return null;
}

function formatExecutorFailureMessage(input: {
  expectedFormat: "stream-json" | "json";
  message: string;
  exitCode?: number | null;
  stdoutPreview?: string | null;
  stderrPreview?: string | null;
  blocker?: RuntimeBlocker | null;
}): string {
  const parts = [
    input.message,
    `Output format: ${input.expectedFormat}.`
  ];

  if (input.exitCode !== undefined && input.exitCode !== null) {
    parts.push(`Exit code: ${input.exitCode}.`);
  }

  if (input.blocker) {
    parts.push(`Blocker: ${input.blocker.kind}.`);
  }

  if (input.stdoutPreview) {
    parts.push(`stdout: "${input.stdoutPreview}".`);
  }

  if (input.stderrPreview) {
    parts.push(`stderr: "${input.stderrPreview}".`);
  }

  return parts.join(" ");
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
    const unparsedStdoutLines: string[] = [];
    const recentStdoutLines: string[] = [];
    const recentStderrLines: string[] = [];
    const abortController = new AbortController();
    const warnedBlockers = new Set<RuntimeBlockerKind>();
    let lastObservedActivityAt = Date.now();
    let lastProgressAt = Date.now();
    let lastHeartbeatAt = 0;
    let activeBlocker: RuntimeBlocker | null = null;
    let watchdogFailureMessage: string | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    this.abortControllersByTaskId.set(request.task.id, abortController);

    try {
      const emitProgress = async (message: string) => {
        if (!onProgress) {
          return;
        }
        await onProgress({
          taskId: request.task.id,
          type: "executor_progress",
          message,
          createdAt: new Date().toISOString()
        });
      };

      const noteBlocker = async (line: string) => {
        const blocker = detectRuntimeBlocker(line);
        if (!blocker) {
          return;
        }

        activeBlocker = blocker;
        if (warnedBlockers.has(blocker.kind)) {
          return;
        }
        warnedBlockers.add(blocker.kind);
        lastProgressAt = Date.now();
        await emitProgress(`Potential blocker: ${blocker.message}`);
      };

      watchdog = setInterval(() => {
        const now = Date.now();
        const timeSinceProgress = now - lastProgressAt;
        const timeSinceActivity = now - lastObservedActivityAt;

        if (
          timeSinceProgress >= HEARTBEAT_START_MS &&
          now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS
        ) {
          lastHeartbeatAt = now;
          lastProgressAt = now;
          void emitProgress(
            "Execution heartbeat: Gemini CLI is still running locally and Relay is waiting for a structured result."
          );
        }

        if (
          activeBlocker &&
          timeSinceActivity >= BLOCKER_FAILURE_IDLE_MS &&
          !abortController.signal.aborted
        ) {
          watchdogFailureMessage = formatExecutorFailureMessage({
            expectedFormat: command.outputFormat,
            message: "Gemini CLI remained blocked without new progress and Relay stopped the local run.",
            blocker: activeBlocker,
            stdoutPreview: recentStdoutLines.at(-1) ?? null,
            stderrPreview: recentStderrLines.at(-1) ?? null
          });
          abortController.abort();
        }
      }, WATCHDOG_TICK_MS);

      const result = await this.exec(command.command, command.args, {
        cwd: command.cwd,
        env: buildGeminiCliEnvironment(),
        signal: abortController.signal,
        onStdoutLine: async (line) => {
          lastObservedActivityAt = Date.now();
          rememberDiagnosticLine(recentStdoutLines, line);
          await noteBlocker(line);
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
          await this.onRawEvent?.(contextualEvent);

          const progressEvent = toExecutorProgressEvent(
            request.task.id,
            request.now,
            contextualEvent
          );

          if (progressEvent && onProgress) {
            lastProgressAt = Date.now();
            await onProgress(progressEvent);
          }

          const terminalFailure = detectTerminalFailure(contextualEvent);
          if (terminalFailure) {
            throw new Error(terminalFailure);
          }
        },
        onStderrLine: async (line) => {
          lastObservedActivityAt = Date.now();
          rememberDiagnosticLine(recentStderrLines, line);
          await noteBlocker(line);
        }
      });
      if (watchdog) {
        clearInterval(watchdog);
        watchdog = null;
      }

      let parsed;
      try {
        parsed = parseGeminiCliOutput(result.stdout);
      } catch (error) {
        const preview = unparsedStdoutLines[0]?.trim();
        throw new Error(
          formatExecutorFailureMessage({
            expectedFormat: command.outputFormat,
            message: `Gemini CLI did not return usable structured output in ${command.outputFormat} mode.`,
            exitCode: result.exitCode,
            stdoutPreview: preview ?? recentStdoutLines.at(-1) ?? null,
            stderrPreview: recentStderrLines.at(-1) ?? null,
            blocker: activeBlocker
          })
        );
      }
      try {
        return await buildExecutorResultFromGeminiCliOutput({
          taskId: request.task.id,
          now: request.now,
          output: parsed,
          expectedFormat: command.outputFormat
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          formatExecutorFailureMessage({
            expectedFormat: command.outputFormat,
            message,
            exitCode: result.exitCode,
            stdoutPreview: recentStdoutLines.at(-1) ?? null,
            stderrPreview: recentStderrLines.at(-1) ?? null,
            blocker: activeBlocker
          })
        );
      }
    } catch (error) {
      if (watchdogFailureMessage && isExecutorCancelledError(error)) {
        throw new Error(watchdogFailureMessage);
      }
      throw error;
    } finally {
      if (watchdog) {
        clearInterval(watchdog);
      }
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
