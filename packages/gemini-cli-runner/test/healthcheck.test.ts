import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { probeGeminiCliHealth } from "../src/healthcheck.js";

describe("probeGeminiCliHealth", () => {
  it("reports missing binary when the configured CLI path is not executable", async () => {
    const result = await probeGeminiCliHealth({
      phase: "binary",
      env: {
        ...process.env,
        GEMINI_CLI_PATH: "/tmp/definitely-missing-gemini"
      },
      now: () => "2026-03-16T00:00:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "unhealthy",
        code: "missing_binary",
        canRunLocalTasks: false,
        commandPath: "/tmp/definitely-missing-gemini"
      })
    );
  });

  it("classifies auth failures reported on stdout", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: "Authentication failed. Please login with OAuth.",
        stderr: "",
        exitCode: 1
      })
    });

    expect(result.code).toBe("missing_auth");
    expect(result.status).toBe("unhealthy");
  });

  it("classifies auth failures reported only on stderr", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: "",
        stderr: "No credentials found. Run gcloud auth application-default login.",
        exitCode: 1
      })
    });

    expect(result.code).toBe("missing_auth");
    expect(result.stderrSnippet).toContain("No credentials found");
  });

  it("classifies permission-denied probe failures", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: "",
        stderr: "Permission denied while reading the Desktop folder.",
        exitCode: 1
      })
    });

    expect(result.code).toBe("permission_denied");
  });

  it("classifies timed out probes", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      timeoutMs: 10,
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          stdout: "",
          stderr: "",
          exitCode: null
        };
      }
    });

    expect(result.code).toBe("probe_timeout");
    expect(result.canRunLocalTasks).toBe(false);
  });

  it("reports healthy when the probe returns stream-json output", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: '{"type":"result","status":"success","response":"READY"}',
        stderr: "",
        exitCode: 0
      })
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "healthy",
        code: "healthy",
        canRunLocalTasks: true
      })
    );
  });

  it("runs the full probe with the same GEMINI_CLI_PATH override it validates", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "gemini-health-"));
    const binaryPath = join(tempDir, "gemini");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);

    let commandUsed = "";
    try {
      const result = await probeGeminiCliHealth({
        phase: "full",
        now: () => "2026-03-16T00:00:00.000Z",
        env: {
          ...process.env,
          GEMINI_CLI_PATH: binaryPath
        },
        probeRunner: async (file) => {
          commandUsed = file;
          return {
            stdout: '{"type":"result","status":"success","response":"READY"}',
            stderr: "",
            exitCode: 0
          };
        }
      });

      expect(commandUsed).toBe(binaryPath);
      expect(result.commandPath).toBe(binaryPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
