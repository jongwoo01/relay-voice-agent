import { describe, expect, it } from "vitest";
import { createLocalExecutionLayer } from "../src/main/execution/local-execution-layer.js";

describe("local-execution-layer", () => {
  it("defaults to mock execution mode", () => {
    const layer = createLocalExecutionLayer();

    expect(layer.mode).toBe("mock");
    expect(layer.executor).toBeDefined();
  });

  it("uses gemini mode when requested", () => {
    const layer = createLocalExecutionLayer({ mode: "gemini" });

    expect(layer.mode).toBe("gemini");
    expect(layer.executor).toBeDefined();
  });
});
