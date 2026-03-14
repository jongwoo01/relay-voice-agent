import { describe, expect, it } from "vitest";
import {
  GeminiIntentResolver,
  type IntentModelClientLike
} from "../src/index.js";

describe("GeminiIntentResolver", () => {
  it("reads structured JSON intent output from the model", async () => {
    const client: IntentModelClientLike = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            intent: "task_request",
            assistantReplyText: ""
          })
        })
      }
    };

    const resolver = new GeminiIntentResolver(client);

    await expect(resolver.resolve("Create a quick prototype")).resolves.toEqual({
      intent: "task_request",
      assistantReplyText: undefined
    });
  });

  it("keeps an assistant reply for non-task intents", async () => {
    const client: IntentModelClientLike = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            intent: "question",
            assistantReplyText: "Paris is the capital of France."
          })
        })
      }
    };

    const resolver = new GeminiIntentResolver(client);

    await expect(resolver.resolve("What is the capital of France?")).resolves.toEqual({
      intent: "question",
      assistantReplyText: "Paris is the capital of France."
    });
  });
});
