import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationOverlay } from "./ConversationOverlay.jsx";

globalThis.React = React;

const noop = vi.fn();

function renderOverlay(timeline) {
  return renderToStaticMarkup(
    createElement(ConversationOverlay, {
      open: true,
      onClose: noop,
      timeline,
      turnsById: new Map(
        timeline.map((item) => [
          item.turnId,
          {
            turnId: item.turnId,
            inputMode: item.inputMode,
            stage:
              item.kind === "user_message"
                ? "thinking"
                : item.kind === "task_event"
                  ? "waiting_input"
                  : "responding"
          }
        ])
      ),
      prompt: "",
      onPromptChange: noop,
      onSubmit: noop,
      onCompositionStart: noop,
      onCompositionEnd: noop,
      onPromptKeyDown: noop
    })
  );
}

describe("ConversationOverlay", () => {
  it("renders assistant messages without requiring user chat bubbles", () => {
    const markup = renderOverlay([
      {
        id: "turn-1:assistant",
        turnId: "turn-1",
        kind: "assistant_message",
        inputMode: "voice",
        speaker: "assistant",
        text: "Okay, I'll check right away.",
        partial: false,
        streaming: false,
        interrupted: false,
        responseSource: "live",
        createdAt: "2026-03-15T10:00:01.000Z",
        updatedAt: "2026-03-15T10:00:01.000Z"
      }
    ]);

    expect(markup).toContain("Okay, I&#x27;ll check right away.");
    expect(markup).toContain("assistant · live");
  });

  it("uses distinct visual treatment for system/task messages", () => {
    const markup = renderOverlay([
      {
        id: "turn-1:task",
        turnId: "turn-1",
        kind: "task_event",
        inputMode: "typed",
        speaker: "system",
        text: "Need one more detail.",
        partial: false,
        streaming: false,
        interrupted: false,
        createdAt: "2026-03-15T10:00:01.000Z",
        updatedAt: "2026-03-15T10:00:01.000Z"
      }
    ]);

    expect(markup).toContain("Need one more detail.");
    expect(markup).toContain("border-amber-200");
    expect(markup).toContain("task event");
  });

  it("shows an interrupted assistant message with a status badge instead of strike-through", () => {
    const markup = renderOverlay([
      {
        id: "turn-2:assistant",
        turnId: "turn-2",
        kind: "assistant_message",
        inputMode: "voice",
        speaker: "assistant",
        text: "I was about to explain the next step.",
        partial: false,
        streaming: false,
        interrupted: true,
        responseSource: "live",
        createdAt: "2026-03-15T10:00:02.000Z",
        updatedAt: "2026-03-15T10:00:02.000Z"
      }
    ]);

    expect(markup).toContain("Stopped early");
    expect(markup).toContain("I was about to explain the next step.");
    expect(markup).not.toContain("line-through");
  });
});
