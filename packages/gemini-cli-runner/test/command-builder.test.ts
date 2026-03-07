import { describe, expect, it } from "vitest";
import { buildGeminiCliCommand } from "../src/command-builder.js";

describe("buildGeminiCliCommand", () => {
  it("builds a new task command with positional prompt and stream-json output", () => {
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
      args: ["Organize my browser tabs", "--output-format", "stream-json"],
      cwd: "/tmp"
    });
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
      "Continue the tab cleanup",
      "--output-format",
      "stream-json"
    ]);
  });
});
