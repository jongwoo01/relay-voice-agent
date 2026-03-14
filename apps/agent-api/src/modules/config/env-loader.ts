import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function parseDotEnv(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

function findDotEnvPath(startDirectory: string): string | null {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const envPath = resolve(currentDirectory, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}

export function loadDotEnvFromRoot(
  rootDirectory: string = process.cwd()
): Record<string, string> {
  const envPath = findDotEnvPath(rootDirectory);

  if (!envPath) {
    return {};
  }

  const parsed = parseDotEnv(readFileSync(envPath, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  return parsed;
}
