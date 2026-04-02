import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { resolveDefaultWorkingDirectory } from "@agent/gemini-cli-runner";

function trimString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return {};
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function resolveWorkspacePath(inputPath, homeDirectory = homedir()) {
  const candidate = trimString(inputPath);
  return path.resolve(
    candidate ??
      resolveDefaultWorkingDirectory({
        homeDirectory
      }) ??
      homeDirectory
  );
}

function normalizePathForCompare(value, platform = process.platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isTrustRuleValue(value) {
  return value === "TRUST_FOLDER" || value === "TRUST_PARENT_FOLDER";
}

function isUntrustedRuleValue(value) {
  return (
    value === "DO_NOT_TRUST" ||
    value === "DONT_TRUST" ||
    value === "UNTRUSTED" ||
    value === "SAFE_MODE"
  );
}

function findEffectiveTrustRule(trustedFolders, workspacePath) {
  const workspaceNormalized = normalizePathForCompare(workspacePath);
  let bestMatch = null;

  for (const [rulePath, ruleValue] of Object.entries(trustedFolders)) {
    if (typeof ruleValue !== "string") {
      continue;
    }

    const normalizedRulePath = normalizePathForCompare(rulePath);
    const exactMatch = workspaceNormalized === normalizedRulePath;
    const nestedMatch =
      workspaceNormalized.startsWith(`${normalizedRulePath}${path.sep}`) ||
      workspaceNormalized.startsWith(`${normalizedRulePath}/`) ||
      workspaceNormalized.startsWith(`${normalizedRulePath}\\`);

    if (!exactMatch && !nestedMatch) {
      continue;
    }

    if (
      !bestMatch ||
      normalizedRulePath.length > normalizePathForCompare(bestMatch.rulePath).length
    ) {
      bestMatch = {
        rulePath,
        ruleValue
      };
    }
  }

  return bestMatch;
}

export async function inspectGeminiWorkspaceTrust({
  settingsPath,
  trustedFoldersPath,
  workspacePath,
  homeDirectory = homedir()
}) {
  const resolvedWorkspacePath = resolveWorkspacePath(workspacePath, homeDirectory);
  const settings = await readJsonFile(settingsPath);
  const trustedFolders = await readJsonFile(trustedFoldersPath);
  const folderTrustEnabled = settings?.security?.folderTrust?.enabled === true;
  const effectiveRule = findEffectiveTrustRule(trustedFolders, resolvedWorkspacePath);
  const trusted = effectiveRule ? isTrustRuleValue(effectiveRule.ruleValue) : false;
  const explicitlyUntrusted = effectiveRule
    ? isUntrustedRuleValue(effectiveRule.ruleValue)
    : false;

  return {
    folderTrustEnabled,
    workspacePath: resolvedWorkspacePath,
    settingsPath,
    trustedFoldersPath,
    trusted,
    explicitlyUntrusted,
    effectiveRulePath: effectiveRule?.rulePath ?? null,
    effectiveRuleValue: effectiveRule?.ruleValue ?? null
  };
}

export async function disableGeminiFolderTrust({
  settingsPath
}) {
  const settings = await readJsonFile(settingsPath);
  const nextSettings = {
    ...settings,
    security: {
      ...(isRecord(settings.security) ? settings.security : {}),
      folderTrust: {
        ...(isRecord(settings.security?.folderTrust) ? settings.security.folderTrust : {}),
        enabled: false
      }
    }
  };

  await writeJsonFile(settingsPath, nextSettings);
  return nextSettings;
}

export async function trustGeminiWorkspace({
  trustedFoldersPath,
  workspacePath,
  homeDirectory = homedir()
}) {
  const resolvedWorkspacePath = resolveWorkspacePath(workspacePath, homeDirectory);
  const trustedFolders = await readJsonFile(trustedFoldersPath);
  const nextTrustedFolders = {
    ...trustedFolders,
    [resolvedWorkspacePath]: "TRUST_FOLDER"
  };

  await writeJsonFile(trustedFoldersPath, nextTrustedFolders);
  return nextTrustedFolders;
}
