import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import {
  buildGeminiCliHealthCommand,
  resolveGeminiCliCommand
} from "./command-builder.js";
import { buildGeminiCliEnvironment, type ExecResult } from "./subprocess-executor.js";
import { resolvePlatformSpawnCommand } from "./windows-spawn.js";

export type GeminiCliHealthCode =
  | "healthy"
  | "missing_binary"
  | "missing_auth"
  | "permission_denied"
  | "probe_timeout"
  | "probe_failed_unknown";

export type GeminiCliHealthStatus = "healthy" | "unhealthy";

export type GeminiCliHealthPhase = "binary" | "full";

export type GeminiCliAuthStrategy =
  | "cached_google"
  | "gemini_api_key"
  | "vertex_ai"
  | "unknown";

export interface GeminiCliHealthResult {
  status: GeminiCliHealthStatus;
  code: GeminiCliHealthCode;
  summary: string;
  detail: string;
  checkedAt: string;
  canRunLocalTasks: boolean;
  commandPath: string;
  authStrategy?: GeminiCliAuthStrategy;
  exitCode?: number | null;
  probeWorkingDirectory?: string;
  stdoutSnippet?: string;
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
  workingDirectory?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 25_000;
const EXPECTED_HEALTH_RESPONSE = "READY";
const HEALTH_PROBE_SUMMARY = "Gemini CLI readiness check passed.";
const HEALTH_PROBE_DETAIL =
  "Gemini CLI answered a minimal non-interactive probe in this environment.";

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

function parseJsonObjectString(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function detectAuthStrategy(env: NodeJS.ProcessEnv): GeminiCliAuthStrategy {
  if (
    env.GOOGLE_GENAI_USE_VERTEXAI?.trim().toLowerCase() === "true" ||
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GOOGLE_CLOUD_PROJECT_ID?.trim() ||
    env.GOOGLE_CLOUD_LOCATION?.trim()
  ) {
    return "vertex_ai";
  }

  if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) {
    return "gemini_api_key";
  }

  return "cached_google";
}

function normalizeProbeResponse(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[.!?]+$/, "").trim().toUpperCase();
}

function toHealthyResult(input: {
  checkedAt: string;
  commandPath: string;
  authStrategy: GeminiCliAuthStrategy;
  summary: string;
  detail: string;
  exitCode?: number | null;
  probeWorkingDirectory?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
}): GeminiCliHealthResult {
  return {
    status: "healthy",
    code: "healthy",
    summary: input.summary,
    detail: input.detail,
    checkedAt: input.checkedAt,
    canRunLocalTasks: true,
    commandPath: input.commandPath,
    authStrategy: input.authStrategy,
    exitCode: input.exitCode,
    probeWorkingDirectory: input.probeWorkingDirectory,
    stdoutSnippet: input.stdoutSnippet,
    stderrSnippet: input.stderrSnippet
  };
}

function toUnhealthyResult(input: {
  checkedAt: string;
  commandPath: string;
  code: Exclude<GeminiCliHealthCode, "healthy">;
  authStrategy: GeminiCliAuthStrategy;
  exitCode?: number | null;
  probeWorkingDirectory?: string;
  stdoutSnippet?: string;
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
      summary: "Gemini CLI authentication is not ready.",
      detail:
        "Gemini CLI could not authenticate with the current local auth path. Check login or configured credentials, then retry."
    },
    permission_denied: {
      summary: "Local permissions are blocking Gemini CLI.",
      detail:
        "Grant the required OS or folder permissions for Relay and Gemini CLI, then retry the health check."
    },
    probe_timeout: {
      summary: "Gemini CLI health check timed out.",
      detail:
        "The CLI did not complete the minimal readiness probe in time. Check local auth, connectivity, or CLI startup behavior, then retry."
    },
    probe_failed_unknown: {
      summary: "Gemini CLI readiness is not confirmed.",
      detail:
        "The minimal non-interactive probe did not return the expected structured READY response."
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
    authStrategy: input.authStrategy,
    exitCode: input.exitCode,
    probeWorkingDirectory: input.probeWorkingDirectory,
    stdoutSnippet: input.stdoutSnippet,
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
    (text.includes("spawn ") && text.includes(" gemini"))
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
    const platformCommand = resolvePlatformSpawnCommand({
      file,
      args,
      env: options.env
    });
    const child: ChildProcessWithoutNullStreams = spawn(
      platformCommand.file,
      platformCommand.args,
      {
        cwd: options.cwd,
        env: options.env,
        stdio: "pipe",
        windowsHide: platformCommand.windowsHide
      }
    );

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

function buildHealthProbeCommand(input: {
  env: NodeJS.ProcessEnv;
  workingDirectory?: string;
}): { command: string; args: string[]; cwd: string } {
  const command = buildGeminiCliHealthCommand(
    {
      workingDirectory: input.workingDirectory ?? homedir()
    },
    input.env
  );

  return {
    command: command.command,
    args: command.args,
    cwd: command.cwd ?? homedir()
  };
}

function extractExpectedProbeResponse(stdout: string): string | null {
  const parsed = parseJsonObjectString(stdout);
  if (!parsed) {
    return null;
  }

  return typeof parsed.response === "string" ? parsed.response.trim() : null;
}

export async function probeGeminiCliHealth(
  options: ProbeGeminiCliHealthOptions = {}
): Promise<GeminiCliHealthResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const checkedAt = now();
  const env = buildGeminiCliEnvironment(options.env);
  const resolvedCommand = resolveGeminiCliCommand(options.env);
  const commandPath = formatCommandPath(resolvedCommand, env);
  const authStrategy = detectAuthStrategy(env);
  const phase = options.phase ?? "full";

  if (!isAbsolute(resolvedCommand)) {
    if (!commandPath || commandPath === resolvedCommand) {
      return toUnhealthyResult({
        checkedAt,
        commandPath,
        code: "missing_binary",
        authStrategy
      });
    }
  } else if (!isExecutableFile(resolvedCommand)) {
    return toUnhealthyResult({
      checkedAt,
      commandPath: resolvedCommand,
      code: "missing_binary",
      authStrategy
    });
  }

  if (phase === "binary") {
    return toHealthyResult({
      checkedAt,
      commandPath,
      authStrategy,
      summary: "Gemini CLI binary is available.",
      detail: "Relay can invoke the local Gemini CLI command on this machine."
    });
  }

  const probeRunner = options.probeRunner ?? defaultProbeRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeCommand = buildHealthProbeCommand({
    env: options.env ?? process.env,
    workingDirectory: options.workingDirectory
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = (await Promise.race([
      probeRunner(probeCommand.command, probeCommand.args, {
        env,
        cwd: probeCommand.cwd,
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

    const stdoutSnippet = normalizeSnippet(result.stdout);
    const stderrSnippet = normalizeSnippet(result.stderr);
    const probeResponse =
      result.exitCode === 0
        ? normalizeProbeResponse(extractExpectedProbeResponse(result.stdout))
        : null;

    if (result.exitCode === 0 && probeResponse === EXPECTED_HEALTH_RESPONSE) {
      return toHealthyResult({
        checkedAt,
        commandPath,
        authStrategy,
        summary: HEALTH_PROBE_SUMMARY,
        detail: HEALTH_PROBE_DETAIL,
        exitCode: result.exitCode,
        probeWorkingDirectory: probeCommand.cwd,
        stdoutSnippet,
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
      authStrategy,
      exitCode: result.exitCode,
      probeWorkingDirectory: probeCommand.cwd,
      stdoutSnippet,
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
      authStrategy,
      probeWorkingDirectory: probeCommand.cwd,
      stderrSnippet: normalizeSnippet(
        error instanceof Error ? error.message : String(error)
      )
    });
  }
}
