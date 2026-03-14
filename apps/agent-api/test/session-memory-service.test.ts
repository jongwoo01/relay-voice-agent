import { describe, expect, it, vi } from "vitest";
import {
  GeminiSessionMemoryExtractor,
  InMemorySessionMemoryRepository,
  SessionMemoryService,
  type SessionMemoryModelClientLike
} from "../src/index.js";

function createModelClient(responses: Record<string, string>): SessionMemoryModelClientLike {
  return {
    models: {
      generateContent: vi.fn(async ({ contents }) => {
        const utteranceLine = contents
          .split("\n")
          .find((line: string) => line.startsWith("Latest user utterance: "));
        const utterance = utteranceLine?.slice("Latest user utterance: ".length) ?? "";
        return {
          text:
            responses[utterance] ??
            JSON.stringify({
              storeItems: []
            })
        };
      })
    }
  };
}

describe("session-memory-service", () => {
  it("stores a useful session fact chosen by the model", async () => {
    const repository = new InMemorySessionMemoryRepository();
    const service = new SessionMemoryService(repository, {
      extract: async () => [
        {
          kind: "identity",
          key: "preferred_name",
          summary: "Preferred name: Sam",
          valueText: "Sam",
          importance: "high",
          confidence: 0.98
        }
      ]
    });

    const result = await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "Call me Sam",
      now: "2026-03-15T00:00:00.000Z"
    });

    expect(result.updated).toBe(true);
    await expect(service.buildRuntimeContext("brain-1")).resolves.toContain(
      "Preferred name: Sam"
    );
  });

  it("reuses the same key to replace older session memory within one session", async () => {
    const repository = new InMemorySessionMemoryRepository();
    const service = new SessionMemoryService(
      repository,
      {
        extract: vi
          .fn()
          .mockResolvedValueOnce([
            {
              kind: "preference",
              key: "response_style",
              summary: "User prefers concise answers.",
              valueText: "concise",
              importance: "medium",
              confidence: 0.9
            }
          ])
          .mockResolvedValueOnce([
            {
              kind: "preference",
              key: "response_style",
              summary: "User prefers detailed answers.",
              valueText: "detailed",
              importance: "medium",
              confidence: 0.92
            }
          ])
      }
    );

    await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "Keep it concise.",
      now: "2026-03-15T00:00:00.000Z"
    });
    await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "Actually, detailed answers are better.",
      now: "2026-03-15T00:01:00.000Z"
    });

    await expect(service.buildRuntimeContext("brain-1")).resolves.toContain(
      "User prefers detailed answers."
    );
    await expect(service.buildRuntimeContext("brain-1")).resolves.not.toContain(
      "User prefers concise answers."
    );
  });

  it("stays isolated per brain session", async () => {
    const repository = new InMemorySessionMemoryRepository();
    const service = new SessionMemoryService(repository, {
      extract: async () => [
        {
          kind: "identity",
          key: "preferred_name",
          summary: "Preferred name: Sam",
          valueText: "Sam",
          importance: "high",
          confidence: 0.98
        }
      ]
    });

    await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "Call me Sam",
      now: "2026-03-15T00:00:00.000Z"
    });

    await expect(service.buildRuntimeContext("brain-2")).resolves.toBe("");
  });

  it("parses structured model output and ignores invalid rows", async () => {
    const repository = new InMemorySessionMemoryRepository();
    const client = createModelClient({
      "Call me Sam and keep answers short.": JSON.stringify({
        storeItems: [
          {
            kind: "identity",
            key: "preferred_name",
            summary: "Preferred name: Sam",
            valueText: "Sam",
            importance: "high",
            confidence: 0.97
          },
          {
            kind: "preference",
            key: "response_style",
            summary: "User prefers concise answers.",
            valueText: "concise",
            importance: "medium",
            confidence: 0.88
          },
          {
            kind: "unknown",
            key: "bad",
            summary: "ignore me",
            valueText: "ignore me",
            importance: "medium",
            confidence: 0.5
          }
        ]
      })
    });
    const extractor = new GeminiSessionMemoryExtractor(client, "test-model");
    const service = new SessionMemoryService(repository, extractor);

    const result = await service.rememberFromUtterance({
      brainSessionId: "brain-structured",
      text: "Call me Sam and keep answers short.",
      now: "2026-03-15T00:00:00.000Z"
    });

    expect(result.updated).toBe(true);
    await expect(service.buildRuntimeContext("brain-structured")).resolves.toContain(
      "Preferred name: Sam"
    );
    await expect(service.buildRuntimeContext("brain-structured")).resolves.toContain(
      "User prefers concise answers."
    );
  });
});
