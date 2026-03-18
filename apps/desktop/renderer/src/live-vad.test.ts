import { describe, expect, it } from "vitest";
import {
  classifyLiveSpeechCandidate,
  deriveLiveSpeechGate
} from "./live-vad.js";

const baseConfig = {
  minSpeechThreshold: 0.05,
  confirmMs: 220,
  transientRmsRatio: 0.36
};

describe("live-vad", () => {
  it("requires a stricter gate when the assistant is already speaking", () => {
    const normalGate = deriveLiveSpeechGate(baseConfig, 0.06, {
      assistantSpeaking: false
    });
    const bargeInGate = deriveLiveSpeechGate(baseConfig, 0.06, {
      assistantSpeaking: true
    });

    expect(bargeInGate.onsetThreshold).toBeGreaterThan(normalGate.onsetThreshold);
    expect(bargeInGate.confirmMs).toBeGreaterThan(normalGate.confirmMs);
    expect(bargeInGate.minRms).toBeGreaterThan(normalGate.minRms);
  });

  it("rejects low-rms rustle-like input while allowing sustained speech-like input", () => {
    const rustle = classifyLiveSpeechCandidate({
      activityLevel: 0.09,
      rms: 0.015,
      threshold: 0.06,
      config: baseConfig,
      assistantSpeaking: true
    });
    const speech = classifyLiveSpeechCandidate({
      activityLevel: 0.11,
      rms: 0.07,
      threshold: 0.06,
      config: baseConfig,
      assistantSpeaking: true
    });

    expect(rustle.accepted).toBe(false);
    expect(speech.accepted).toBe(true);
  });
});
