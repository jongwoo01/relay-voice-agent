import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";
import { accessSync, constants } from "node:fs";
import type { ExecutorRunRequest } from "@agent/local-executor-protocol";
import { buildGeminiCliCommand, resolveGeminiCliCommand } from "./command-builder.js";
import { buildGeminiCliEnvironment, type ExecResult } from "./subprocess-executor.js";

export type GeminiCliHealthCode =
  | "healthy"
  | "missing_binary"
  | "missing_auth"
  | "permission_denied"
  | "probe_timeout"
  | "probe_failed_unknown";

export type GeminiCliHealthStatus = "healthy" | "unhealthy";

export type GeminiCliHealthPhase = "binary" | "full";

export interface GeminiCliHealthResult {
  status: GeminiCliHealthStatus;
  code: GeminiCliHealthCode;
  summary: string;
  detail: string;
  checkedAt: string;
  canRunLocalTasks: boolean;
  commandPath: string;
  stderrSnippet?: string;
}

export interface ProbeRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type ProbeRunner = (
  file: string,
  args: string[],
  options?: ProbeRunnerOptions
) => Promise<ExecResult>;

export interface ProbeGeminiCliHealthOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  timeoutMs?: number;
  phase?: GeminiCliHealthPhase;
  probeRunner?: ProbeRunner;
}

const DEFAULT_PROBE_TIMEOUT_MS = 8_000;
const AUTH_PROBE_PROMPT = "Reply with the single word READY.";

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv
): string | null {
  const pathValue = env.PATH?.split(delimiter).filter(Boolean) ?? [];
  for (const entry of pathValue) {
    const candidate = join(entry, command);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeSnippet(value: string | undefined, max = 240): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function combinedText(input: {
  stdout?: string;
  stderr?: string;
  error?: unknown;
}): string {
  const errorText =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
        ? input.error
        : "";

  return [input.stdout ?? "", input.stderr ?? "", errorText].join("\n").toLowerCase();
}

function toHealthyResult(input: {
  checkedAt: string;
  commandPath: string;
  stderrSnippet?: string;
}): GeminiCliHealthResult {
  return {
    status: "healthy",
    code: "healthy",
    summary: "Gemini CLI is ready on this machine.",
    detail: "Local Gemini-backed tasks can run.",
    checkedAt: input.checkedAt,
    canRunLocalTasks: true,
    commandPath: input.commandPath,
    stderrSnippet: input.stderrSnippet
  };
}

function toUnhealthyResult(input: {
  checkedAt: string;
  commandPath: string;
  code: Exclude<GeminiCliHealthCode, "healthy">;
  stderrSnippet?: string;
}): GeminiCliHealthResult {
  const messages: Record<
    Exclude<GeminiCliHealthCode, "healthy">,
    { summary: string; detail: string }
  > = {
    missing_binary: {
      summary: "Gemini CLI is not available locally.",
      detail:
        "Install Gemini CLI on this machine and make sure Relay can find it in /usr/local/bin, /opt/homebrew/bin, your PATH, or GEMINI_CLI_PATH."
    },
    missing_auth: {
      summary: "Gemini CLI needs Google authentication.",
      detail:
        "Authenticate Gemini CLI on this machine, then retry the health check before starting local tasks."
    },
    permission_denied: {
      summary: "Local permissions are blocking Gemini CLI.",
      detail:
        "Grant the required OS or folder permissions for Relay and Gemini CLI, then retry the health check."
    },
    probe_timeout: {
      summary: "Gemini CLI health check timed out.",
      detail:
        "The CLI did not finish its startup/auth probe in time. Check local auth or connectivity, then retry."
    },
    probe_failed_unknown: {
      summary: "Gemini CLI could not complete its readiness check.",
      detail:
        "Review the saved executor details, fix the local Gemini CLI setup, and retry the health check."
    }
  };

  const message = messages[input.code];
  return {
    status: "unhealthy",
    code: input.code,
    summary: message.summary,
    detail: message.detail,
    checkedAt: input.checkedAt,
    canRunLocalTasks: false,
    commandPath: input.commandPath,
    stderrSnippet: input.stderrSnippet
  };
}

function classifyFailureCode(input: {
  stdout?: string;
  stderr?: string;
  error?: unknown;
  timedOut?: boolean;
}): Exclude<GeminiCliHealthCode, "healthy"> {
  if (input.timedOut) {
    return "probe_timeout";
  }

  const text = combinedText(input);
  if (
    text.includes("enoent") ||
    text.includes("not found") ||
    text.includes("spawn ") && text.includes(" gemini")
  ) {
    return "missing_binary";
  }

  if (
    text.includes("permission denied") ||
    text.includes("operation not permitted") ||
    text.includes("eacces") ||
    text.includes("access denied")
  ) {
    return "permission_denied";
  }

  if (
    text.includes("oauth") ||
    text.includes("authenticate") ||
    text.includes("authentication") ||
    text.includes("not logged in") ||
    text.includes("login required") ||
    text.includes("reauth") ||
    text.includes("credentials") ||
    text.includes("insufficient authentication scopes") ||
    text.includes("gcloud auth") ||
    text.includes("please login")
  ) {
    return "missing_auth";
  }

  return "probe_failed_unknown";
}

function formatCommandPath(command: string, env: NodeJS.ProcessEnv): string {
  if (isAbsolute(command)) {
    return command;
  }

  return findExecutableOnPath(command, env) ?? command;
}

async function defaultProbeRunner(
  file: string,
  args: string[],
  options: ProbeRunnerOptions = {}
): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const finishResolve = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        stdout,
        stderr,
        exitCode
      });
    };

    const timer =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGTERM");
            } catch {
              // Ignore shutdown failures during timeout handling.
            }
          }, options.timeoutMs)
        : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      finishReject(error);
    });

    child.on("close", (exitCode) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        finishReject(new Error("Gemini CLI health check timed out."));
        return;
      }

      finishResolve(exitCode);
    });
  });
}

function buildHealthProbeCommand(
  env: NodeJS.ProcessEnv
): { command: string; args: string[] } {
  const request: ExecutorRunRequest = {
    task: {
      id: "health-check",
      title: "Gemini CLI health check",
      normalizedGoal: "gemini cli health check",
      status: "queued",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    now: new Date(0).toISOString(),
    prompt: AUTH_PROBE_PROMPT
  };

  const command = buildGeminiCliCommand(request, env);
  return {
    command: command.command,
    args: command.args
  };
}

export async function probeGeminiCliHealth(
  options: ProbeGeminiCliHealthOptions = {}
): Promise<GeminiCliHealthResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const checkedAt = now();
  const env = buildGeminiCliEnvironment(options.env);
  const resolvedCommand = resolveGeminiCliCommand(options.env);
  const commandPath = formatCommandPath(resolvedCommand, env);
  const phase = options.phase ?? "full";

  if (!isAbsolute(resolvedCommand)) {
    if (!commandPath || commandPath === resolvedCommand) {
      return toUnhealthyResult({
        checkedAt,
        commandPath,
        code: "missing_binary"
      });
    }
  } else if (!isExecutableFile(resolvedCommand)) {
    return toUnhealthyResult({
      checkedAt,
      commandPath: resolvedCommand,
      code: "missing_binary"
    });
  }

  if (phase === "binary") {
    return toHealthyResult({
      checkedAt,
      commandPath
    });
  }

  const probeRunner = options.probeRunner ?? defaultProbeRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeCommand = buildHealthProbeCommand(options.env ?? process.env);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = (await Promise.race([
      probeRunner(probeCommand.command, probeCommand.args, {
        env,
        timeoutMs
      }),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error("Gemini CLI health check timed out."));
        }, timeoutMs);
      })
    ])) as ExecResult;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    const stderrSnippet = normalizeSnippet(result.stderr);
    if (result.exitCode === 0 && result.stdout.trim()) {
      return toHealthyResult({
        checkedAt,
        commandPath,
        stderrSnippet
      });
    }

    return toUnhealthyResult({
      checkedAt,
      commandPath,
      code: classifyFailureCode({
        stdout: result.stdout,
        stderr: result.stderr
      }),
      stderrSnippet
    });
  } catch (error) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return toUnhealthyResult({
      checkedAt,
      commandPath,
      code: classifyFailureCode({
        error,
        timedOut:
          error instanceof Error &&
          error.message.toLowerCase().includes("timed out")
      }),
      stderrSnippet: normalizeSnippet(
        error instanceof Error ? error.message : String(error)
      )
    });
  }
}
