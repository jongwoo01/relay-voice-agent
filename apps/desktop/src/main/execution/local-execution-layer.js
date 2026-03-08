import { GeminiCliExecutor, MockExecutor } from "@agent/agent-api";

export function resolveExecutionMode(input) {
  if (typeof input !== "string") {
    return "gemini";
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === "mock") {
    return "mock";
  }

  return "gemini";
}

export function createLocalExecutionLayer(options = {}) {
  const mode = resolveExecutionMode(options.mode);
  const debugEnabled = options.debugEnabled ?? process.env.NODE_ENV !== "production";
  const rawEvents = [];
  const onRawEvent = async (event) => {
    if (debugEnabled) {
      rawEvents.push(event);
      if (rawEvents.length > 60) {
        rawEvents.shift();
      }
    }

    if (options.onRawEvent) {
      await options.onRawEvent(event);
    }
  };

  return {
    mode,
    debug: {
      enabled: debugEnabled,
      rawEvents
    },
    executor:
      mode === "gemini"
        ? new GeminiCliExecutor(undefined, onRawEvent)
        : new MockExecutor()
  };
}
