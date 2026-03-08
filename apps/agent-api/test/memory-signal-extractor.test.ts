import { describe, expect, it } from "vitest";
import { extractMemorySignals } from "../src/index.js";

describe("memory-signal-extractor", () => {
  it("extracts immediate profile and preference cues", () => {
    const signals = extractMemorySignals("내 이름은 준호고, 따뜻한 말투를 좋아해");

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "profile",
          policy: "immediate"
        }),
        expect.objectContaining({
          type: "preferences",
          policy: "immediate"
        })
      ])
    );
  });

  it("extracts background life-log and open loop cues", () => {
    const signals = extractMemorySignals("오늘 운동했고, 아직 세금 정리는 못 했어");

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "dated_life_log",
          policy: "background"
        }),
        expect.objectContaining({
          type: "open_loops",
          policy: "background"
        })
      ])
    );
  });
});
