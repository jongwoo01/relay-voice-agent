import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  GeminiApiConfigurationError,
  resolveGeminiApiLiveConfig,
  VertexAiConfigurationError,
  classifyVertexAiFailure,
  resolveVertexAiConfig,
  VertexAiGenAiClientFactory
} from "../src/index.js";

describe("vertex-ai-config", () => {
  it("resolves required Vertex AI env config", () => {
    const config = resolveVertexAiConfig({
      GOOGLE_CLOUD_PROJECT: "demo-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_GENAI_API_VERSION: "v1"
    });

    expect(config).toMatchObject({
      project: "demo-project",
      location: "us-central1",
      apiVersion: "v1"
    });
  });

  it("throws a configuration error when required env is missing", () => {
    expect(() =>
      resolveVertexAiConfig({
        GOOGLE_CLOUD_LOCATION: "us-central1"
      })
    ).toThrow(VertexAiConfigurationError);
  });

  it("classifies quota and auth failures distinctly", () => {
    expect(
      classifyVertexAiFailure(
        new Error(
          "ApiError 429 RESOURCE_EXHAUSTED Quota exceeded for metric aiplatform.googleapis.com/generate_content_requests_per_minute_per_project"
        )
      )
    ).toBe("quota_exhausted");
    expect(
      classifyVertexAiFailure(
        new Error("Request failed with 403 PERMISSION_DENIED for Vertex AI")
      )
    ).toBe("auth_failed");
  });

  it("resolves Gemini Developer API live config from GEMINI_API_KEY", () => {
    const config = resolveGeminiApiLiveConfig({
      GEMINI_API_KEY: "demo-key"
    });

    expect(config).toEqual({
      apiKey: "demo-key",
      liveModel: DEFAULT_GEMINI_LIVE_MODEL
    });
  });

  it("throws when Gemini Developer API live config is missing an API key", () => {
    expect(() => resolveGeminiApiLiveConfig({})).toThrow(
      GeminiApiConfigurationError
    );
  });

  it("creates a Vertex AI client factory with explicit runtime metadata", () => {
    const factory = new VertexAiGenAiClientFactory(
      resolveVertexAiConfig({
        GOOGLE_CLOUD_PROJECT: "demo-project",
        GOOGLE_CLOUD_LOCATION: "us-central1"
      }),
      {
        GEMINI_API_KEY: "demo-key"
      }
    );

    expect(factory.getRuntimeMetadata()).toMatchObject({
      modelsBackend: "vertexai",
      liveBackend: "gemini_api",
      project: "demo-project",
      location: "us-central1",
      liveApiKeyConfigured: true
    });
  });
});
