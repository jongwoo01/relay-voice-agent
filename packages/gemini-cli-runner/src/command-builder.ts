import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExecutorRunRequest } from "@agent/local-executor-protocol";
import { buildExecutorPrompt as buildExecutorPromptText } from "./prompts.js";

export interface GeminiCliCommand {
  command: string;
  args: string[];
  cwd?: string;
  outputFormat: GeminiCliOutputFormat;
}

export interface GeminiCliHealthCommandInput {
  workingDirectory?: string;
}

export interface GeminiCliWorkspaceProbeCommandInput {
  workingDirectory?: string;
  expectedChildName?: string | null;
}

export type GeminiCliOutputFormat = "stream-json" | "json";
export type WindowsShellMode = "avoid" | "allow";

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface DefaultWorkingDirectoryOptions {
  homeDirectory?: string;
  currentWorkingDirectory?: string;
}

export function resolveDefaultWorkingDirectory(
  options: DefaultWorkingDirectoryOptions = {}
): string | undefined {
  const homeDirectory = options.homeDirectory ?? homedir();
  let currentWorkingDirectory = options.currentWorkingDirectory;

  if (currentWorkingDirectory === undefined) {
    try {
      currentWorkingDirectory = process.cwd();
    } catch {
      currentWorkingDirectory = undefined;
    }
  }

  const candidates = [
    homeDirectory ? join(homeDirectory, "Desktop") : undefined,
    homeDirectory,
    currentWorkingDirectory
  ];

  for (const candidate of candidates) {
    if (candidate && isDirectory(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveLocalWorkingDirectory(input?: string): string | undefined {
  const candidate = input?.trim();
  if (!candidate) {
    return undefined;
  }

  if (isDirectory(candidate)) {
    return candidate;
  }

  return resolveDefaultWorkingDirectory();
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

function buildExecutorPrompt(
  request: ExecutorRunRequest,
  platform: NodeJS.Platform = process.platform
): string {
  const workingDirectory = resolveLocalWorkingDirectory(request.workingDirectory);
  return buildExecutorPromptText({
    prompt: request.prompt,
    workingDirectory,
    platform,
    windowsShellMode: resolveWindowsShellMode(request, platform)
  });
}

function normalizeKeywordInput(request: ExecutorRunRequest): string {
  return [
    request.prompt,
    request.task.title,
    request.task.normalizedGoal
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

export function resolveWindowsShellMode(
  request: ExecutorRunRequest,
  platform: NodeJS.Platform = process.platform
): WindowsShellMode {
  if (platform !== "win32") {
    return "allow";
  }

  const text = normalizeKeywordInput(request);
  const shellKeywords = [
    "test",
    "tests",
    "build",
    "install",
    "run ",
    " run",
    "execute",
    "server",
    "start ",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "git",
    "commit",
    "migration",
    "migrate",
    "lint",
    "format",
    "prettier",
    "eslint",
    "codegen",
    "generate",
    "pytest",
    "cargo",
    "make ",
    "docker",
    "powershell",
    "cmd.exe",
    "테스트",
    "빌드",
    "설치",
    "실행",
    "서버",
    "커밋",
    "마이그레이션",
    "린트",
    "포맷",
    "코드젠"
  ];

  return shellKeywords.some((keyword) => text.includes(keyword)) ? "allow" : "avoid";
}

export function resolveGeminiCliOutputFormat(
  platform: NodeJS.Platform = process.platform
): GeminiCliOutputFormat {
  return platform === "win32" ? "json" : "stream-json";
}

export function buildGeminiCliCommand(
  request: ExecutorRunRequest,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): GeminiCliCommand {
  const workingDirectory = resolveLocalWorkingDirectory(request.workingDirectory);
  const prompt = buildExecutorPrompt(request, platform);
  const outputFormat = resolveGeminiCliOutputFormat(platform);
  const args = request.resumeSessionId
    ? [
        "-r",
        request.resumeSessionId,
        "-p",
        prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        outputFormat
      ]
    : [
        "-p",
        prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        outputFormat
      ];

  return {
    command: resolveGeminiCliCommand(env),
    args,
    cwd: workingDirectory,
    outputFormat
  };
}

export function buildGeminiCliHealthCommand(
  input: GeminiCliHealthCommandInput = {},
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): GeminiCliCommand {
  const workingDirectory = resolveLocalWorkingDirectory(input.workingDirectory);
  const outputFormat = resolveGeminiCliOutputFormat(platform);

  return {
    command: resolveGeminiCliCommand(env),
    args: [
      "-p",
      "Reply exactly READY.",
      "--output-format",
      outputFormat,
      "--extensions",
      ""
    ],
    cwd: workingDirectory,
    outputFormat
  };
}

export function buildGeminiCliWorkspaceProbeCommand(
  input: GeminiCliWorkspaceProbeCommandInput = {},
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): GeminiCliCommand {
  const workingDirectory = resolveLocalWorkingDirectory(input.workingDirectory);
  const outputFormat = resolveGeminiCliOutputFormat(platform);
  const expectedChildName = input.expectedChildName?.trim();
  const probePrompt = expectedChildName
    ? [
        "Inspect the immediate children of the current working directory using built-in file and directory tools only.",
        "Do not use shell commands.",
        `Reply exactly PROBE_OK:${expectedChildName} where the suffix is the alphabetically first immediate child name.`
      ].join(" ")
    : [
        "Inspect the current working directory using built-in file and directory tools only.",
        "Do not use shell commands.",
        "Reply exactly PROBE_OK."
      ].join(" ");

  return {
    command: resolveGeminiCliCommand(env),
    args: [
      "-p",
      probePrompt,
      "--approval-mode",
      "yolo",
      "--output-format",
      outputFormat,
      "--extensions",
      ""
    ],
    cwd: workingDirectory,
    outputFormat
  };
}
