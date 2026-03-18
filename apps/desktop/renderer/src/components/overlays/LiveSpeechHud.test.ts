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
    routing: {
      mode: "idle",
      summary: "",
      detail: ""
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
        routing: { mode: "capturing", summary: "Listening to your request.", detail: "" },
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
        routing: { mode: "responding", summary: "Preparing a reply.", detail: "" },
        inputPartial: "사용자 마지막 partial",
        outputTranscript: "알겠어요. 확인해볼게요."
      })
    ).toEqual([
      expect.objectContaining({
        speaker: "Relay",
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
        routing: { mode: "idle", summary: "", detail: "" },
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
        routing: { mode: "capturing", summary: "Listening to your request.", detail: "" },
        inputPartial: "Testing one two",
        outputTranscript: ""
      })
    );

    expect(markup).not.toContain("You");
    expect(markup).not.toContain("Testing one two");
  });

  it("does not render meta guidance text when there is no assistant transcript yet", () => {
    expect(
      buildHudBubbles({
        sessionActive: true,
        voiceState: createVoiceState({
          status: "finishing",
          activity: { userSpeaking: false, assistantSpeaking: false }
        }),
        routing: { mode: "finishing", summary: "Finishing the reply.", detail: "" },
        inputPartial: "",
        outputTranscript: ""
      })
    ).toEqual([]);
  });
});
