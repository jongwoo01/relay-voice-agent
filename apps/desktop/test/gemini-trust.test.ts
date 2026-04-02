import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  disableGeminiFolderTrust,
  inspectGeminiWorkspaceTrust,
  trustGeminiWorkspace
} from "../src/main/setup/gemini-trust.js";

describe("gemini trust helpers", () => {
  it("detects when trusted folders are disabled", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "relay-gemini-trust-"));
    const settingsPath = path.join(tempRoot, "settings.json");
    const trustedFoldersPath = path.join(tempRoot, "trustedFolders.json");

    try {
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            security: {
              folderTrust: {
                enabled: false
              }
            }
          },
          null,
          2
        )
      );

      const inspection = await inspectGeminiWorkspaceTrust({
        settingsPath,
        trustedFoldersPath,
        workspacePath: path.join(tempRoot, "workspace")
      });

      expect(inspection.folderTrustEnabled).toBe(false);
      expect(inspection.trusted).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("detects trust inherited from a parent rule", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "relay-gemini-trust-"));
    const settingsPath = path.join(tempRoot, "settings.json");
    const trustedFoldersPath = path.join(tempRoot, "trustedFolders.json");
    const workspacePath = path.join(tempRoot, "workspace", "nested");

    try {
      mkdirSync(workspacePath, { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            security: {
              folderTrust: {
                enabled: true
              }
            }
          },
          null,
          2
        )
      );
      writeFileSync(
        trustedFoldersPath,
        JSON.stringify(
          {
            [path.join(tempRoot, "workspace")]: "TRUST_PARENT_FOLDER"
          },
          null,
          2
        )
      );

      const inspection = await inspectGeminiWorkspaceTrust({
        settingsPath,
        trustedFoldersPath,
        workspacePath
      });

      expect(inspection.folderTrustEnabled).toBe(true);
      expect(inspection.trusted).toBe(true);
      expect(inspection.effectiveRuleValue).toBe("TRUST_PARENT_FOLDER");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes disabled folder trust to settings.json", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "relay-gemini-trust-"));
    const settingsPath = path.join(tempRoot, ".gemini", "settings.json");

    try {
      await disableGeminiFolderTrust({
        settingsPath
      });

      const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(saved.security.folderTrust.enabled).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes a TRUST_FOLDER rule for the requested workspace", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "relay-gemini-trust-"));
    const trustedFoldersPath = path.join(tempRoot, ".gemini", "trustedFolders.json");
    const workspacePath = path.join(tempRoot, "workspace");

    try {
      mkdirSync(workspacePath, { recursive: true });
      await trustGeminiWorkspace({
        trustedFoldersPath,
        workspacePath
      });

      const saved = JSON.parse(readFileSync(trustedFoldersPath, "utf8"));
      expect(saved[workspacePath]).toBe("TRUST_FOLDER");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the default workspace when no explicit workspace is provided", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "relay-gemini-trust-"));
    const trustedFoldersPath = path.join(tempRoot, ".gemini", "trustedFolders.json");
    const fakeHome = mkdtempSync(path.join(tmpdir(), "relay-gemini-home-"));
    const desktopPath = path.join(fakeHome, "Desktop");

    try {
      mkdirSync(desktopPath, { recursive: true });
      await trustGeminiWorkspace({
        trustedFoldersPath,
        homeDirectory: fakeHome
      });

      const saved = JSON.parse(readFileSync(trustedFoldersPath, "utf8"));
      expect(saved[desktopPath]).toBe("TRUST_FOLDER");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
