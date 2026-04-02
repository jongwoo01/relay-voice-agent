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

export type GeminiCliOutputFormat = "stream-json" | "json";

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
    platform
  });
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
