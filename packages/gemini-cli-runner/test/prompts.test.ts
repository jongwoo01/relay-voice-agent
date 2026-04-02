import { describe, expect, it } from "vitest";
import { buildExecutorPrompt } from "../src/prompts.js";

describe("executor prompt registry", () => {
  it("builds the local Gemini CLI execution prompt with REPORT_JSON contract", () => {
    const prompt = buildExecutorPrompt({
      prompt: "Organize my browser tabs",
      workingDirectory: "/tmp"
    });

    expect(prompt).toContain("You are executing a local desktop task.");
    expect(prompt).toContain("Working directory: /tmp");
    expect(prompt).toContain("User task:\nOrganize my browser tabs");
    expect(prompt).toContain(
      'After that, add a new line that starts with REPORT_JSON: followed by a single-line JSON object with this shape:'
    );
    expect(prompt).toContain('"summary":"string"');
    expect(prompt).toContain(
      "Do not expand a simple listing request into a broader filesystem crawl just to be extra thorough."
    );
  });

  it("falls back to the default workspace label when no working directory is supplied", () => {
    const prompt = buildExecutorPrompt({
      prompt: "Reply with READY"
    });

    expect(prompt).toContain(
      "Working directory: current default workspace"
    );
  });

  it("adds Windows-specific shell guidance on win32", () => {
    const prompt = buildExecutorPrompt({
      prompt: "Inspect my project files",
      platform: "win32",
      windowsShellMode: "avoid"
    });

    expect(prompt).toContain("You are running on Windows.");
    expect(prompt).toContain(
      "This task should stay on built-in file and directory tools unless shell commands are absolutely required"
    );
    expect(prompt).toContain("compatible with cmd.exe");
  });

  it("allows Windows shell guidance for execution-heavy tasks", () => {
    const prompt = buildExecutorPrompt({
      prompt: "Run the test suite and fix failures",
      platform: "win32",
      windowsShellMode: "allow"
    });

    expect(prompt).toContain("The user request likely needs command execution");
    expect(prompt).toContain("Use built-in file and directory tools first for inspection");
  });
});
