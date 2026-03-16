import { describe, expect, it } from "vitest";
import {
  createLocalExecutionLayer,
  resolveExecutionMode
} from "../src/main/execution/local-execution-layer.js";

describe("local-execution-layer", () => {
  it("defaults to gemini execution mode", () => {
    const layer = createLocalExecutionLayer();

    expect(layer.mode).toBe("gemini");
    expect(layer.debug.enabled).toBe(true);
    expect(layer.debug.rawEvents).toEqual([]);
    expect(layer.executor).toBeDefined();
  });

  it("uses gemini mode when requested", () => {
    const layer = createLocalExecutionLayer({ mode: "gemini" });

    expect(layer.mode).toBe("gemini");
    expect(layer.executor).toBeDefined();
  });

  it("uses mock mode when requested", () => {
    const layer = createLocalExecutionLayer({ mode: "mock" });

    expect(layer.mode).toBe("mock");
    expect(layer.executor).toBeDefined();
  });

  it("falls back to gemini for unknown mode", () => {
    expect(resolveExecutionMode("invalid")).toBe("gemini");
    expect(resolveExecutionMode(undefined)).toBe("gemini");
  });

  it("can disable debug raw event capture", () => {
    const layer = createLocalExecutionLayer({ debugEnabled: false });
    expect(layer.debug.enabled).toBe(false);
  });

  it("reports a healthy mock executor probe result", async () => {
    const layer = createLocalExecutionLayer({ mode: "mock" });

    await expect(
      layer.probeHealth({
        phase: "full",
        now: () => "2026-03-16T00:00:00.000Z"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "healthy",
        code: "healthy",
        commandPath: "mock"
      })
    );
  });
});
