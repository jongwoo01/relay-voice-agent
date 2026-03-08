import { describe, expect, it } from "vitest";
import {
  FallbackIntentResolver,
  GeminiIntentResolver,
  HeuristicIntentResolver,
  inferIntentFromText,
  type IntentModelClientLike,
  type IntentResolver
} from "../src/index.js";

describe("inferIntentFromText", () => {
  it("classifies task-oriented text as task_request", () => {
    expect(inferIntentFromText("브라우저 탭 정리해줘")).toBe("task_request");
  });

  it("classifies korean imperative information requests as task_request", () => {
    expect(inferIntentFromText("내 바탕화면 폴더갯수랑 이름말해라")).toBe(
      "task_request"
    );
    expect(inferIntentFromText("다운로드 폴더 파일 목록 알려줘")).toBe(
      "task_request"
    );
    expect(inferIntentFromText("내 바탕화면에 무슨 폴더나 파일이 있는지 보이니?")).toBe(
      "task_request"
    );
  });

  it("classifies english imperative requests as task_request", () => {
    expect(inferIntentFromText("code something for me")).toBe("task_request");
    expect(inferIntentFromText("build a quick prototype")).toBe("task_request");
  });

  it("classifies explicit questions as question", () => {
    expect(inferIntentFromText("How is the task going?")).toBe("question");
  });

  it("falls back to small_talk for normal chat", () => {
    expect(inferIntentFromText("안녕")).toBe("small_talk");
  });
});

describe("HeuristicIntentResolver", () => {
  it("wraps heuristic intent inference behind the resolver interface", async () => {
    const resolver = new HeuristicIntentResolver();

    await expect(resolver.resolve("브라우저 탭 정리해줘")).resolves.toBe("task_request");
  });
});

describe("GeminiIntentResolver", () => {
  it("reads a structured JSON intent from the model", async () => {
    const client: IntentModelClientLike = {
      models: {
        generateContent: async () => ({
          text: "{\"intent\":\"task_request\"}"
        })
      }
    };

    const resolver = new GeminiIntentResolver(client);

    await expect(resolver.resolve("code something for me")).resolves.toBe("task_request");
  });
});

describe("FallbackIntentResolver", () => {
  it("uses the fallback resolver when the primary resolver fails", async () => {
    const primary: IntentResolver = {
      async resolve(): Promise<never> {
        throw new Error("primary failed");
      }
    };
    const fallback: IntentResolver = {
      async resolve() {
        return "small_talk";
      }
    };

    const resolver = new FallbackIntentResolver(primary, fallback);

    await expect(resolver.resolve("안녕")).resolves.toBe("small_talk");
  });
});
