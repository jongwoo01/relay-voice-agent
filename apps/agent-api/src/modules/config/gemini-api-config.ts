export interface GeminiApiLiveConfig {
  apiKey: string;
  liveModel: string;
}

export interface GeminiApiLiveRuntimeMetadata {
  liveBackend: "gemini_api";
  liveModel: string;
  liveApiKeyConfigured: boolean;
}

export class GeminiApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiApiConfigurationError";
  }
}

export const DEFAULT_GEMINI_LIVE_MODEL =
  "gemini-2.5-flash-native-audio-preview-12-2025";

function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const geminiApiKey = env.GEMINI_API_KEY?.trim();
  if (geminiApiKey) {
    return geminiApiKey;
  }

  const googleApiKey = env.GOOGLE_API_KEY?.trim();
  return googleApiKey || undefined;
}

export function resolveGeminiApiLiveConfig(
  env: NodeJS.ProcessEnv = process.env
): GeminiApiLiveConfig {
  const apiKey = resolveApiKey(env);
  if (!apiKey) {
    throw new GeminiApiConfigurationError(
      "Gemini Developer API live requires GEMINI_API_KEY or GOOGLE_API_KEY to be set."
    );
  }

  return {
    apiKey,
    liveModel: env.LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL
  };
}

export function toGeminiApiLiveRuntimeMetadata(
  env: NodeJS.ProcessEnv = process.env
): GeminiApiLiveRuntimeMetadata {
  return {
    liveBackend: "gemini_api",
    liveModel: env.LIVE_MODEL?.trim() || DEFAULT_GEMINI_LIVE_MODEL,
    liveApiKeyConfigured: Boolean(resolveApiKey(env))
  };
}
