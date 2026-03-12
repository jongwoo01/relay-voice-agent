import { describe, expect, it } from "vitest";
import { buildGeminiCliCommand } from "../src/command-builder.js";

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

    expect(command).toEqual({
      command: "gemini",
      args: [
        "-p",
        expect.stringContaining("User task:\nOrganize my browser tabs"),
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ],
      cwd: "/tmp"
    });
    expect(command.args[1]).toContain("Working directory: /tmp");
    expect(command.args[1]).toContain('"summary":"string"');
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
});
