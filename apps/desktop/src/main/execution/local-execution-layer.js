import {
  GeminiCliExecutor,
  MockExecutor,
  probeGeminiCliHealth
} from "@agent/gemini-cli-runner";

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
    probeHealth:
      mode === "gemini"
        ? (healthOptions) => probeGeminiCliHealth(healthOptions)
        : async ({ now } = {}) => ({
            status: "healthy",
            code: "healthy",
            summary: "Mock executor is active.",
            detail: "Local tasks will use the mock executor in this desktop session.",
            checkedAt: typeof now === "function" ? now() : new Date().toISOString(),
            canRunLocalTasks: true,
            commandPath: "mock"
          }),
    executor:
      mode === "gemini"
        ? new GeminiCliExecutor(undefined, onRawEvent)
        : new MockExecutor()
  };
}
