import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import {
  buildGeminiCliEnvironment,
  resolveGeminiCliCommand,
  resolvePlatformSpawnCommand
} from "@agent/gemini-cli-runner";

const SETUP_PROBE_TIMEOUT_MS = 4_500;

function createItemStatus(status, summary, detail, extra = {}) {
  return {
    status,
    summary,
    detail,
    ...extra
  };
}

function trimString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOutputSnippet(value, max = 240) {
  const normalized = trimString(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  return undefined;
}

async function probeDirectoryAccess(pathValue) {
  const normalizedPath = trimString(pathValue);
  if (!normalizedPath) {
    return {
      path: null,
      status: "missing",
      detail: "Path is not available on this system."
    };
  }

  try {
    await access(normalizedPath, fsConstants.R_OK | fsConstants.X_OK);
    await readdir(normalizedPath, { withFileTypes: false });
    return {
      path: normalizedPath,
      status: "granted",
      detail: "Readable by the app process."
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    const message =
      error instanceof Error ? error.message : `Directory probe failed (${code}).`;
    return {
      path: normalizedPath,
      status: "probe_failed",
      errorCode: code,
      detail: message
    };
  }
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const platformCommand = resolvePlatformSpawnCommand({
      file,
      args,
      env: options.env
    });
    const child = spawn(platformCommand.file, platformCommand.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
      windowsHide: platformCommand.windowsHide
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore shutdown failures during timeout handling.
      }
      reject(new Error("Command timed out."));
    }, options.timeoutMs ?? SETUP_PROBE_TIMEOUT_MS);

    const finish = (fn) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", finish(reject));
    child.on(
      "close",
      finish((exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode
        });
      })
    );
  });
}

async function probeGeminiBinary(env = process.env) {
  const runtimeEnv = buildGeminiCliEnvironment(env);
  const resolvedCommand = resolveGeminiCliCommand(env);
  const commandSource = trimString(env.GEMINI_CLI_PATH)
    ? "gemini_cli_path"
    : "path_lookup";
  const commandPath = isAbsolute(resolvedCommand)
    ? resolvedCommand
    : trimString(runtimeEnv.PATH)?.includes(resolvedCommand)
      ? resolvedCommand
      : resolvedCommand;

  try {
    const result = await runCommand(resolvedCommand, ["--version"], {
      env: runtimeEnv
    });
    const versionText = normalizeOutputSnippet(result.stdout || result.stderr, 120);
    if (result.exitCode === 0 && versionText) {
      return createItemStatus(
        "ready",
        "Gemini CLI binary is available.",
        "Relay can invoke the local Gemini CLI binary.",
        {
          commandPath,
          commandSource,
          version: versionText
        }
      );
    }

    return createItemStatus(
      "warning",
      "Gemini CLI binary responded unexpectedly.",
      "Relay found a Gemini CLI command but could not confirm a clean version response.",
      {
        commandPath,
        commandSource,
        version: versionText,
        stderrSnippet: normalizeOutputSnippet(result.stderr)
      }
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Gemini CLI binary could not be executed.";
    return createItemStatus(
      "error",
      "Gemini CLI binary is not available.",
      "Install Gemini CLI on this machine or expose it through GEMINI_CLI_PATH.",
      {
        commandPath,
        commandSource,
        version: null,
        stderrSnippet: normalizeOutputSnippet(detail)
      }
    );
  }
}

async function probeHostedBackend(baseUrl, sessionToken) {
  const normalizedBaseUrl = trimString(baseUrl);
  if (!normalizedBaseUrl) {
    return createItemStatus(
      "error",
      "Hosted backend URL is missing.",
      "Relay does not know which hosted backend to probe.",
      {
        baseUrl: null,
        authState: "unknown"
      }
    );
  }

  const endpoint = new URL("/judge/history", normalizedBaseUrl);
  try {
    const response = await fetch(endpoint, {
      headers: trimString(sessionToken)
        ? {
            authorization: `Bearer ${sessionToken}`
          }
        : undefined,
      signal: createTimeoutSignal(SETUP_PROBE_TIMEOUT_MS)
    });

    if (response.ok) {
      return createItemStatus(
        "ready",
        "Hosted backend is reachable.",
        trimString(sessionToken)
          ? "Relay can reach the hosted backend with an authenticated session."
          : "Relay can reach the hosted backend. Connect with a judge passcode to open the live session.",
        {
          baseUrl: normalizedBaseUrl,
          authState: trimString(sessionToken) ? "authenticated" : "reachable"
        }
      );
    }

    if (response.status === 401 || response.status === 403) {
      return createItemStatus(
        "warning",
        "Hosted backend is reachable but not authenticated.",
        "Relay can reach the backend. A judge passcode is still required before the live session can start.",
        {
          baseUrl: normalizedBaseUrl,
          authState: "auth_required"
        }
      );
    }

    return createItemStatus(
      "error",
      `Hosted backend responded with ${response.status}.`,
      "Relay reached the backend, but the probe endpoint did not respond as expected.",
      {
        baseUrl: normalizedBaseUrl,
        authState: "unexpected_response"
      }
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Hosted backend probe failed.";
    return createItemStatus(
      "error",
      "Hosted backend is unreachable.",
      "Relay could not reach the hosted backend. Check the network or AGENT_CLOUD_URL.",
      {
        baseUrl: normalizedBaseUrl,
        authState: "unreachable",
        stderrSnippet: normalizeOutputSnippet(detail)
      }
    );
  }
}

export function createEmptySetupStatus() {
  return {
    checkedAt: null,
    hostedBackend: createItemStatus(
      "unknown",
      "Hosted backend has not been checked yet.",
      "Relay will probe the backend when setup status is refreshed."
    ),
    microphone: createItemStatus(
      "unknown",
      "Microphone access has not been checked yet.",
      "Grant microphone access before starting a live voice session."
    ),
    localExecutorBinary: createItemStatus(
      "unknown",
      "Gemini CLI binary has not been checked yet.",
      "Relay will probe the local Gemini CLI binary when setup status is refreshed."
    ),
    localFileAccess: createItemStatus(
      "unknown",
      "Local file access has not been checked yet.",
      "Relay will probe Desktop, Documents, and Downloads access when setup status is refreshed.",
      {
        directories: []
      }
    )
  };
}

export function getGeminiConfigPaths(homeDirectory = homedir()) {
  const geminiDirectory = join(homeDirectory, ".gemini");
  return {
    homeDirectory,
    geminiDirectory,
    settingsPath: join(geminiDirectory, "settings.json"),
    envPath: join(geminiDirectory, ".env"),
    trustedFoldersPath: join(geminiDirectory, "trustedFolders.json")
  };
}

export async function collectSetupStatus({
  baseUrl,
  sessionToken = null,
  executorHealth,
  microphonePermissionStatus,
  lastExecutorWorkingDirectory = null,
  desktopPath = null,
  documentsPath = null,
  downloadsPath = null,
  env = process.env,
  now = () => new Date().toISOString()
} = {}) {
  const checkedAt = now();
  const [hostedBackend, localExecutorBinary] = await Promise.all([
    probeHostedBackend(baseUrl, sessionToken),
    probeGeminiBinary(env)
  ]);

  const directories = await Promise.all([
    probeDirectoryAccess(desktopPath).then((result) => ({
      key: "desktop",
      label: "Desktop",
      ...result
    })),
    probeDirectoryAccess(documentsPath).then((result) => ({
      key: "documents",
      label: "Documents",
      ...result
    })),
    probeDirectoryAccess(downloadsPath).then((result) => ({
      key: "downloads",
      label: "Downloads",
      ...result
    }))
  ]);

  const failingDirectory = directories.find((item) => item.status !== "granted") ?? null;
  const localFileAccess = failingDirectory
    ? createItemStatus(
        "warning",
        "Some local folders are not readable by the app process.",
        "Relay should be able to inspect local files, but one or more common folders failed a direct access probe.",
        {
          directories,
          probeSource: "app_process"
        }
      )
    : createItemStatus(
        "ready",
        "Common local folders are readable.",
        "Relay can read Desktop, Documents, and Downloads from the app process.",
        {
          directories,
          probeSource: "app_process"
        }
      );

  const microphone =
    microphonePermissionStatus === "granted"
      ? createItemStatus(
          "ready",
          "Microphone permission is granted.",
          "Relay can request live voice capture on this machine.",
          {
            permissionStatus: microphonePermissionStatus
          }
        )
      : microphonePermissionStatus === "denied" ||
          microphonePermissionStatus === "restricted"
        ? createItemStatus(
            "error",
            "Microphone permission is blocked.",
            "Grant microphone access in the system privacy settings before starting a live voice session.",
            {
              permissionStatus: microphonePermissionStatus
            }
          )
        : createItemStatus(
            "warning",
            "Microphone permission is not confirmed yet.",
            "Relay has not confirmed microphone access on this machine yet.",
            {
              permissionStatus: microphonePermissionStatus
            }
          );

  return {
    checkedAt,
    hostedBackend,
    microphone,
    localExecutorBinary,
    localFileAccess
  };
}

export function getSupportTargetPath(target) {
  const geminiPaths = getGeminiConfigPaths();
  if (target === "gemini_settings") {
    return geminiPaths.settingsPath;
  }

  if (target === "gemini_trusted_folders") {
    return geminiPaths.trustedFoldersPath;
  }

  if (target === "gemini_directory") {
    return geminiPaths.geminiDirectory;
  }

  return null;
}

export function getSupportTargetDirectory(targetPath) {
  const normalized = trimString(targetPath);
  if (!normalized) {
    return null;
  }

  return isAbsolute(normalized) ? dirname(normalized) : null;
}
