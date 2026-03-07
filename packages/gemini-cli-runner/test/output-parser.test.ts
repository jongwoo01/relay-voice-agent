import { describe, expect, it } from "vitest";
import { parseGeminiCliOutput } from "../src/output-parser.js";

describe("parseGeminiCliOutput", () => {
  it("extracts message and sessionId from json output", () => {
    const parsed = parseGeminiCliOutput(
      JSON.stringify({
        session_id: "session-123",
        text: "브라우저 탭 정리를 마쳤어요"
      })
    );

    expect(parsed).toEqual({
      sessionId: "session-123",
      message: "브라우저 탭 정리를 마쳤어요"
    });
  });

  it("throws when the output is empty", () => {
    expect(() => parseGeminiCliOutput("")).toThrow("Gemini CLI output was empty");
  });
});
