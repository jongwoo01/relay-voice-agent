import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveSpeechHud, buildHudBubbles } from "./LiveSpeechHud.jsx";

globalThis.React = React;

function createVoiceState(overrides = {}) {
  return {
    status: "idle",
    activity: {
      userSpeaking: false,
      assistantSpeaking: false
    },
    ...overrides
  };
}

describe("buildHudBubbles", () => {
  it("does not show a user bubble while voice input is actively streaming", () => {
    expect(
      buildHudBubbles({
        sessionActive: true,
        voiceState: createVoiceState({
          status: "listening",
          activity: { userSpeaking: true, assistantSpeaking: false }
        }),
        inputPartial: "지금 말하는 중",
        outputTranscript: ""
      })
    ).toEqual([]);
  });

  it("switches to the assistant bubble once output transcription starts", () => {
    expect(
      buildHudBubbles({
        sessionActive: true,
        voiceState: createVoiceState({
          status: "responding",
          activity: { userSpeaking: false, assistantSpeaking: true }
        }),
        inputPartial: "사용자 마지막 partial",
        outputTranscript: "알겠어요. 확인해볼게요."
      })
    ).toEqual([
      expect.objectContaining({
        speaker: "Gemini",
        tone: "assistant",
        text: "알겠어요. 확인해볼게요."
      })
    ]);
  });

  it("returns no bubbles when the session is inactive", () => {
    expect(
      buildHudBubbles({
        sessionActive: false,
        voiceState: createVoiceState(),
        inputPartial: "hidden",
        outputTranscript: "hidden"
      })
    ).toEqual([]);
  });
});

describe("LiveSpeechHud", () => {
  it("does not render the live user bubble even when inputPartial exists", () => {
    const markup = renderToStaticMarkup(
      createElement(LiveSpeechHud, {
        sessionActive: true,
        voiceState: createVoiceState({
          status: "listening",
          activity: { userSpeaking: true, assistantSpeaking: false }
        }),
        inputPartial: "Testing one two",
        outputTranscript: ""
      })
    );

    expect(markup).not.toContain("You");
    expect(markup).not.toContain("Testing one two");
  });
});
