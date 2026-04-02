import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import {
  buildGeminiCliEnvironment,
  buildGeminiCliWorkspaceProbeCommand,
  parseGeminiCliOutput,
  resolveDefaultWorkingDirectory,
  resolveGeminiCliCommand,
  resolveGeminiCliOutputFormat,
  resolvePlatformSpawnCommand
} from "@agent/gemini-cli-runner";
import { inspectGeminiWorkspaceTrust } from "./gemini-trust.js";

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

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractProbeResponse(output) {
  const resultEvent = output.events.find((event) => event.type === "result");
  if (!resultEvent) {
    return null;
  }

  return firstNonEmptyString([
    resultEvent.payload.response,
    resultEvent.payload.message,
    resultEvent.payload.text,
    resultEvent.payload.output,
    resultEvent.payload.content
  ]);
}

function classifyWorkspaceProbeFailure(text) {
  const normalized = trimString(text)?.toLowerCase();
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
    return "trust";
  }

  if (
    normalized.includes("waiting for approval") ||
    normalized.includes("approval required") ||
    normalized.includes("approve")
  ) {
    return "approval";
  }

  if (
    normalized.includes("cmd.exe") ||
    normalized.includes("powershell") ||
    normalized.includes("shell command") ||
    normalized.includes("run_shell_command")
  ) {
    return "shell";
  }

  if (
    normalized.includes("authentication") ||
    normalized.includes("login required") ||
    normalized.includes("api key") ||
    normalized.includes("credentials")
  ) {
    return "auth";
  }

  if (normalized.includes("permission denied") || normalized.includes("insufficient permission")) {
    return "permission";
  }

  return "unknown";
}

export async function probeGeminiWorkspaceToolsReadiness({
  workspacePath,
  env = process.env,
  timeoutMs = 12_000,
  platform = process.platform
} = {}) {
  const normalizedWorkspace = trimString(workspacePath);
  if (!normalizedWorkspace) {
    return createItemStatus(
      "warning",
      "Workspace tools probe was skipped.",
      "Relay could not determine a workspace path for the Gemini CLI tools probe.",
      {
        workspacePath: null,
        code: "missing_workspace"
      }
    );
  }

  let firstChildName = null;
  try {
    const children = (await readdir(normalizedWorkspace, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    firstChildName = children[0] ?? null;
  } catch (error) {
    return createItemStatus(
      "warning",
      "Workspace tools probe could not inspect the workspace locally.",
      "Relay could not read the current workspace before asking Gemini CLI to inspect it.",
      {
        workspacePath: normalizedWorkspace,
        code: "workspace_read_failed",
        stderrSnippet: normalizeOutputSnippet(
          error instanceof Error ? error.message : String(error)
        )
      }
    );
  }

  const command = buildGeminiCliWorkspaceProbeCommand(
    {
      workingDirectory: normalizedWorkspace,
      expectedChildName: firstChildName
    },
    env,
    platform
  );

  try {
    const result = await runCommand(command.command, command.args, {
      cwd: command.cwd,
      env: buildGeminiCliEnvironment(env),
      timeoutMs
    });
    const parsed = parseGeminiCliOutput(result.stdout);
    const response = extractProbeResponse(parsed);
    const expectedResponse = firstChildName ? `PROBE_OK:${firstChildName}` : "PROBE_OK";
    if (response === expectedResponse) {
      return createItemStatus(
        "ready",
        "Gemini CLI can inspect this workspace.",
        "Relay confirmed that Gemini CLI can inspect the current workspace with file-oriented tools before task execution starts.",
        {
          workspacePath: normalizedWorkspace,
          expectedResponse,
          outputFormat: resolveGeminiCliOutputFormat(platform),
          stdoutSnippet: normalizeOutputSnippet(result.stdout),
          stderrSnippet: normalizeOutputSnippet(result.stderr)
        }
      );
    }

    const combinedFailureText = [response, result.stderr, result.stdout].filter(Boolean).join("\n");
    const blockerCode = classifyWorkspaceProbeFailure(combinedFailureText);
    return createItemStatus(
      blockerCode === "trust" || blockerCode === "approval" ? "error" : "warning",
      "Gemini CLI could not confirm file-tool access for this workspace.",
      blockerCode === "trust"
        ? "Gemini CLI appears to be in safe mode for this workspace. Trust this workspace or disable Trusted Folders before running local tasks."
        : blockerCode === "approval"
          ? "Gemini CLI appears to be waiting for approval before using workspace tools. Trust this workspace or disable Trusted Folders before running local tasks."
          : "Gemini CLI did not prove that it could inspect the current workspace with file-oriented tools.",
      {
        workspacePath: normalizedWorkspace,
        expectedResponse,
        actualResponse: response,
        code: blockerCode,
        outputFormat: resolveGeminiCliOutputFormat(platform),
        stdoutSnippet: normalizeOutputSnippet(result.stdout),
        stderrSnippet: normalizeOutputSnippet(result.stderr)
      }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const blockerCode = classifyWorkspaceProbeFailure(detail);
    return createItemStatus(
      blockerCode === "trust" || blockerCode === "approval" ? "error" : "warning",
      "Gemini CLI workspace tools probe did not complete cleanly.",
      blockerCode === "trust"
        ? "Gemini CLI appears to be blocked by workspace trust before it can use local tools."
        : blockerCode === "approval"
          ? "Gemini CLI appears to be waiting for approval before it can use local tools."
          : "Relay could not complete the local workspace tools probe in time.",
      {
        workspacePath: normalizedWorkspace,
        code: blockerCode,
        outputFormat: resolveGeminiCliOutputFormat(platform),
        stderrSnippet: normalizeOutputSnippet(detail)
      }
    );
  }
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
    ),
    workspaceToolsReady: createItemStatus(
      "unknown",
      "Workspace tools readiness has not been checked yet.",
      "Relay will ask Gemini CLI to confirm file-oriented access to the current workspace when setup status is refreshed.",
      {
        workspacePath: null,
        code: null
      }
    ),
    geminiWorkspaceTrust: createItemStatus(
      "unknown",
      "Gemini workspace trust has not been checked yet.",
      "Relay will inspect Gemini CLI trust settings for the current workspace when setup status is refreshed.",
      {
        folderTrustEnabled: false,
        workspacePath: null,
        settingsPath: null,
        trustedFoldersPath: null,
        trusted: false,
        explicitlyUntrusted: false,
        effectiveRulePath: null,
        effectiveRuleValue: null
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
  const geminiPaths = getGeminiConfigPaths();
  const workspacePath =
    trimString(lastExecutorWorkingDirectory) ??
    resolveDefaultWorkingDirectory({
      homeDirectory: geminiPaths.homeDirectory
    }) ??
    desktopPath ??
    geminiPaths.homeDirectory;

  const [hostedBackend, localExecutorBinary, trustInspection, workspaceToolsReady] =
    await Promise.all([
    probeHostedBackend(baseUrl, sessionToken),
    probeGeminiBinary(env),
    inspectGeminiWorkspaceTrust({
      settingsPath: geminiPaths.settingsPath,
      trustedFoldersPath: geminiPaths.trustedFoldersPath,
      workspacePath,
      homeDirectory: geminiPaths.homeDirectory
    }).catch((error) => ({
      folderTrustEnabled: false,
      workspacePath,
      settingsPath: geminiPaths.settingsPath,
      trustedFoldersPath: geminiPaths.trustedFoldersPath,
      trusted: false,
      explicitlyUntrusted: false,
      effectiveRulePath: null,
      effectiveRuleValue: null,
      inspectionError:
        error instanceof Error ? error.message : String(error)
    })),
    probeGeminiWorkspaceToolsReadiness({
      workspacePath,
      env
    })
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

  const geminiWorkspaceTrust = trustInspection.inspectionError
    ? createItemStatus(
        "warning",
        "Gemini trust settings could not be fully inspected.",
        "Relay could not parse the local Gemini trust configuration cleanly. You can still open or repair the files from here.",
        trustInspection
      )
    : !trustInspection.folderTrustEnabled
    ? createItemStatus(
        "ready",
        "Gemini Trusted Folders is disabled.",
        "Gemini CLI will not force workspace trust checks before running tools in this workspace.",
        trustInspection
      )
    : trustInspection.trusted
      ? createItemStatus(
          "ready",
          "Current workspace is trusted by Gemini CLI.",
          "Gemini CLI can auto-approve tools in this workspace when other settings allow it.",
          trustInspection
        )
      : trustInspection.explicitlyUntrusted
        ? createItemStatus(
            "error",
            "Current workspace is explicitly untrusted.",
            "Gemini CLI will run in safe mode here and can block automatic tool execution until you trust this workspace or disable Trusted Folders.",
            trustInspection
          )
        : createItemStatus(
            "warning",
            "Current workspace is not trusted yet.",
            "If Gemini Trusted Folders is enabled, Gemini CLI can pause for trust or approval here until you trust this workspace or disable the feature.",
            trustInspection
          );

  return {
    checkedAt,
    hostedBackend,
    microphone,
    localExecutorBinary,
    localFileAccess,
    workspaceToolsReady,
    geminiWorkspaceTrust
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
