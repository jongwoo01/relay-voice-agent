import { describe, expect, it } from "vitest";
import { GeminiTaskIntakeResolver } from "../src/modules/conversation/task-intake-resolver.js";

describe("task-intake-resolver", () => {
  it("parses structured JSON from Gemini for start analysis", async () => {
    const resolver = new GeminiTaskIntakeResolver({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            requiredSlots: ["scope"],
            filledSlots: {
              location: "downloads folder"
            }
          })
        })
      }
    });

    await expect(resolver.analyzeStart("Clean up the downloads folder")).resolves.toEqual({
      requiredSlots: ["scope"],
      filledSlots: {
        location: "downloads folder"
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
              scope: "group by file type"
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
          sourceText: "Clean up the downloads folder",
          workingText: "Clean up the downloads folder",
          requiredSlots: ["scope"],
          filledSlots: {
            location: "downloads folder"
          },
          missingSlots: ["scope"],
          lastQuestion: "Tell me what rule or scope to use.",
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z"
        },
        "group by file type"
      )
    ).resolves.toEqual({
      resolution: "answer_current_intake",
      requiredSlots: ["scope"],
      filledSlots: {
        scope: "group by file type"
      }
    });
  });
});
