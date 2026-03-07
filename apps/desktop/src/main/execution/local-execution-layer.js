import { GeminiCliExecutor, MockExecutor } from "@agent/agent-api";

export function createLocalExecutionLayer(options = {}) {
  const mode = options.mode === "gemini" ? "gemini" : "mock";

  return {
    mode,
    executor:
      mode === "gemini"
        ? new GeminiCliExecutor(undefined, options.onRawEvent)
        : new MockExecutor()
  };
}
