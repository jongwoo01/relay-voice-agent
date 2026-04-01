import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { probeGeminiCliHealth } from "../src/healthcheck.js";

function streamJsonResult(response: string): string {
  return JSON.stringify({
    type: "result",
    response
  });
}

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

  it("reports healthy when the probe returns a stream-json result with READY", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: streamJsonResult("READY"),
        stderr: "",
        exitCode: 0
      })
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "healthy",
        code: "healthy",
        canRunLocalTasks: true,
        authStrategy: "cached_google",
        stdoutSnippet: streamJsonResult("READY")
      })
    );
  });

  it("accepts READY with trailing punctuation from the probe response", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: streamJsonResult("READY."),
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.code).toBe("healthy");
  });

  it("fails when the probe response does not match READY exactly", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: streamJsonResult("READY NOW"),
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.code).toBe("probe_failed_unknown");
    expect(result.stdoutSnippet).toContain("READY NOW");
  });

  it("fails when the probe output does not include a real stream-json result event", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: "READY",
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.code).toBe("probe_failed_unknown");
    expect(result.stdoutSnippet).toBe("READY");
  });

  it("accepts stream-json probe output even when stderr contains startup noise", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: [
          JSON.stringify({
            type: "init",
            session_id: "probe-session"
          }),
          streamJsonResult("READY")
        ].join("\n"),
        stderr: "Loaded cached credentials.\nInitializing extension host.",
        exitCode: 0
      })
    });

    expect(result.code).toBe("healthy");
    expect(result.stderrSnippet).toContain("Loaded cached credentials.");
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
            stdout: streamJsonResult("READY"),
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

  it("uses the home directory for the health probe working directory", async () => {
    let cwdUsed = "";

    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async (_file, _args, options) => {
        cwdUsed = options?.cwd ?? "";
        return {
          stdout: streamJsonResult("READY"),
          stderr: "",
          exitCode: 0
        };
      }
    });

    expect(result.code).toBe("healthy");
    expect(cwdUsed).toBe(homedir());
  });

  it("forwards an explicit working directory into the health probe", async () => {
    let cwdUsed = "";

    await probeGeminiCliHealth({
      phase: "full",
      workingDirectory: "/tmp",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async (_file, _args, options) => {
        cwdUsed = options?.cwd ?? "";
        return {
          stdout: streamJsonResult("READY"),
          stderr: "",
          exitCode: 0
        };
      }
    });

    expect(cwdUsed).toBe("/tmp");
  });

  it("detects api key auth strategy from env", async () => {
    const result = await probeGeminiCliHealth({
      phase: "full",
      env: {
        ...process.env,
        GEMINI_API_KEY: "demo-key"
      },
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async () => ({
        stdout: streamJsonResult("READY"),
        stderr: "",
        exitCode: 0
      })
    });

    expect(result.authStrategy).toBe("gemini_api_key");
  });

  it("invokes the health probe with stream-json output and extensions disabled", async () => {
    let argsUsed: string[] = [];

    const result = await probeGeminiCliHealth({
      phase: "full",
      now: () => "2026-03-16T00:00:00.000Z",
      probeRunner: async (_file, args) => {
        argsUsed = [...args];
        return {
          stdout: streamJsonResult("READY"),
          stderr: "",
          exitCode: 0
        };
      }
    });

    expect(result.code).toBe("healthy");
    expect(argsUsed).toEqual([
      "-p",
      "Reply exactly READY.",
      "--output-format",
      "stream-json",
      "--extensions",
      ""
    ]);
  });
});
