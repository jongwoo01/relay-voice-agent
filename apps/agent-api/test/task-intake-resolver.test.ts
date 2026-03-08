import { describe, expect, it } from "vitest";
import {
  GeminiTaskIntakeResolver,
  HeuristicTaskIntakeResolver
} from "../src/modules/conversation/task-intake-resolver.js";

describe("task-intake-resolver", () => {
  it("uses heuristic fallback rules for required and filled slots", async () => {
    const resolver = new HeuristicTaskIntakeResolver();

    await expect(resolver.analyzeStart("다운로드 폴더 파일 정리해줘")).resolves.toEqual({
      requiredSlots: ["scope"],
      filledSlots: {
        location: "다운로드 폴더 파일 정리해줘"
      }
    });
  });

  it("parses structured JSON from Gemini for start analysis", async () => {
    const resolver = new GeminiTaskIntakeResolver({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            requiredSlots: ["scope"],
            filledSlots: {
              location: "다운로드 폴더"
            }
          })
        })
      }
    });

    await expect(resolver.analyzeStart("다운로드 폴더 파일 정리해줘")).resolves.toEqual({
      requiredSlots: ["scope"],
      filledSlots: {
        location: "다운로드 폴더"
      }
    });
  });

  it("parses structured JSON from Gemini for intake update analysis", async () => {
    const resolver = new GeminiTaskIntakeResolver({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            resolution: "answer_current_intake",
            requiredSlots: ["scope"],
            filledSlots: {
              scope: "종류별로"
            }
          })
        })
      }
    });

    await expect(
      resolver.analyzeUpdate(
        {
          brainSessionId: "brain-1",
          status: "collecting",
          sourceText: "다운로드 폴더 파일 정리해줘",
          workingText: "다운로드 폴더 파일 정리해줘",
          requiredSlots: ["scope"],
          filledSlots: {
            location: "다운로드 폴더 파일 정리해줘"
          },
          missingSlots: ["scope"],
          lastQuestion: "어떤 기준으로 할지 알려줘.",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        "종류별로"
      )
    ).resolves.toEqual({
      resolution: "answer_current_intake",
      requiredSlots: ["scope"],
      filledSlots: {
        scope: "종류별로"
      }
    });
  });
});
