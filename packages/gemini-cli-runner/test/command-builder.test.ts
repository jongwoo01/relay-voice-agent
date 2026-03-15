import { describe, expect, it } from "vitest";
import {
  buildGeminiCliCommand,
  resolveGeminiCliCommand
} from "../src/command-builder.js";

describe("buildGeminiCliCommand", () => {
  it("builds a new task command with explicit headless prompt mode", () => {
    const command = buildGeminiCliCommand({
      task: {
        id: "task-1",
        title: "Organize tabs",
        normalizedGoal: "organize tabs",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Organize my browser tabs",
      workingDirectory: "/tmp"
    });

    expect(command.command).toBe(resolveGeminiCliCommand());
    expect(command.args).toEqual([
      "-p",
      expect.stringContaining("User task:\nOrganize my browser tabs"),
      "--approval-mode",
      "yolo",
      "--output-format",
      "stream-json"
    ]);
    expect(command.cwd).toBe("/tmp");
    expect(command.args[1]).toContain("Working directory: /tmp");
    expect(command.args[1]).toContain('"summary":"string"');
    expect(command.args[1]).toContain(
      "Prefer built-in directory and file tools over shell commands"
    );
    expect(command.args[1]).toContain(
      "If the user asks to read, quote, print, or transcribe a local text file, return the requested file contents directly"
    );
    expect(command.args[1]).toContain(
      "Do not replace a direct file-content request with a summary, paraphrase, or invented privacy-policy refusal"
    );
    expect(command.args[1]).toContain(
      "Do not recurse into subdirectories, use ls -R, find, or other deep scans unless the user explicitly asked"
    );
  });

  it("builds a resume command with -r", () => {
    const command = buildGeminiCliCommand({
      task: {
        id: "task-1",
        title: "Organize tabs",
        normalizedGoal: "organize tabs",
        status: "running",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "Continue the tab cleanup",
      resumeSessionId: "session-123"
    });

    expect(command.args).toEqual([
      "-r",
      "session-123",
      "-p",
      expect.stringContaining("User task:\nContinue the tab cleanup"),
      "--approval-mode",
      "yolo",
      "--output-format",
      "stream-json"
    ]);
    expect(command.args[3]).toContain(
      "Working directory: current default workspace"
    );
  });

  it("tells Gemini CLI not to broaden a simple directory listing into a deep scan", () => {
    const command = buildGeminiCliCommand({
      task: {
        id: "task-dir",
        title: "Check Desktop names and counts",
        normalizedGoal: "check desktop names and counts",
        status: "queued",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      now: "2026-03-08T00:00:00.000Z",
      prompt: "check my desktop and tell me every file and folder name and count"
    });

    expect(command.args[1]).toContain(
      "For directory inspection requests, default to the immediate children of the named directory."
    );
    expect(command.args[1]).toContain(
      "Do not expand a simple listing request into a broader filesystem crawl just to be extra thorough."
    );
    expect(command.args[1]).toContain(
      'If the user asked for exact names, IDs, paths, or other concrete items, include those facts in the natural-language answer and in "keyFindings".'
    );
  });

  it("prefers an explicit GEMINI_CLI_PATH override when provided", () => {
    expect(
      resolveGeminiCliCommand({
        GEMINI_CLI_PATH: "/tmp/custom-gemini"
      })
    ).toBe("/tmp/custom-gemini");
  });
});
