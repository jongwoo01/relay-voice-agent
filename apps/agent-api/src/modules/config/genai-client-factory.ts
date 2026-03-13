import { GoogleGenAI } from "@google/genai";
import {
  resolveGeminiApiLiveConfig,
  toGeminiApiLiveRuntimeMetadata,
  type GeminiApiLiveConfig,
  type GeminiApiLiveRuntimeMetadata
} from "./gemini-api-config.js";
import {
  resolveVertexAiConfig,
  toVertexAiRuntimeMetadata,
  type VertexAiConfig,
  type VertexAiRuntimeMetadata
} from "./vertex-ai-config.js";

export interface GenAiRuntimeMetadata
  extends Omit<VertexAiRuntimeMetadata, "backend" | "liveModel">,
    GeminiApiLiveRuntimeMetadata {
  modelsBackend: "vertexai";
}

export interface GenAiClientFactory {
  createModelsClient(): GoogleGenAI;
  createLiveClient(): GoogleGenAI;
  getConfig(): VertexAiConfig;
  getLiveConfig(): GeminiApiLiveConfig;
  getRuntimeMetadata(): GenAiRuntimeMetadata;
}

export class VertexAiGenAiClientFactory implements GenAiClientFactory {
  constructor(
    private readonly config: VertexAiConfig = resolveVertexAiConfig(),
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  createModelsClient(): GoogleGenAI {
    return new GoogleGenAI({
      vertexai: true,
      project: this.config.project,
      location: this.config.location,
      apiVersion: this.config.apiVersion
    });
  }

  createLiveClient(): GoogleGenAI {
    const liveConfig = this.getLiveConfig();
    return new GoogleGenAI({
      apiKey: liveConfig.apiKey
    });
  }

  getConfig(): VertexAiConfig {
    return this.config;
  }

  getLiveConfig(): GeminiApiLiveConfig {
    return resolveGeminiApiLiveConfig(this.env);
  }

  getRuntimeMetadata(): GenAiRuntimeMetadata {
    const vertexMetadata = toVertexAiRuntimeMetadata(this.config);
    const liveMetadata = toGeminiApiLiveRuntimeMetadata(this.env);

    return {
      modelsBackend: "vertexai",
      project: vertexMetadata.project,
      location: vertexMetadata.location,
      apiVersion: vertexMetadata.apiVersion,
      taskRoutingModel: vertexMetadata.taskRoutingModel,
      taskIntakeModel: vertexMetadata.taskIntakeModel,
      intentModel: vertexMetadata.intentModel,
      ...liveMetadata
    };
  }
}

let hasLoggedDefaultFactory = false;

export function createDefaultGenAiClientFactory(): GenAiClientFactory {
  const factory = new VertexAiGenAiClientFactory();
  if (!hasLoggedDefaultFactory) {
    hasLoggedDefaultFactory = true;
    console.log(
      `[genai-client-factory] runtime ${JSON.stringify(factory.getRuntimeMetadata())}`
    );
  }
  return factory;
}
