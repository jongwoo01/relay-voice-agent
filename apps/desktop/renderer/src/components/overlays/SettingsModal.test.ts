import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy(
    {},
    {
      get: () => (props) => createElement("div", props, props.children)
    }
  )
}));

import { SettingsModal } from "./SettingsModal.jsx";

globalThis.React = React;
globalThis.window = {
  desktopSystem: {
    platform: "darwin",
    openMacPrivacySettings: vi.fn()
  }
};

describe("SettingsModal", () => {
  it("renders the planned settings sections and executor diagnostics", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsModal, {
        open: true,
        onClose: vi.fn(),
        settings: {
          audio: {
            defaultMicId: "mic-1",
            startMuted: true
          },
          executor: {
            enabled: true
          },
          ui: {
            motionPreference: "system",
            showHeaderHealthWarnings: true,
            autoOpenCompletedTasks: true
          },
          debug: {
            defaultFilters: {
              transport: true,
              live: true,
              bridge: true,
              runtime: true,
              executor: true
            }
          }
        },
        systemStatus: {
          microphonePermissionStatus: "granted"
        },
        microphones: [
          {
            deviceId: "mic-1",
            label: "Built-in Microphone"
          }
        ],
        selectedMicId: "mic-1",
        selectedMicrophoneLabel: "Built-in Microphone",
        executionMode: "gemini",
        executorHealth: {
          status: "unhealthy",
          code: "missing_auth",
          summary: "Gemini CLI needs authentication.",
          detail: "Sign in to Gemini CLI, then retry the health check.",
          checkedAt: "2026-03-16T00:00:00.000Z",
          commandPath: "/usr/local/bin/gemini"
        },
        historyLoading: false,
        onSelectMicrophone: vi.fn(),
        onRefreshMicrophones: vi.fn(),
        onRequestMicrophoneAccess: vi.fn(),
        onStartMutedChange: vi.fn(),
        onExecutorEnabledChange: vi.fn(),
        onRetryExecutorHealthCheck: vi.fn(),
        onMotionPreferenceChange: vi.fn(),
        onHeaderHealthWarningsChange: vi.fn(),
        onAutoOpenCompletedTasksChange: vi.fn(),
        onOpenDeveloperConsole: vi.fn(),
        debugFilters: {
          transport: true,
          live: true,
          bridge: false,
          runtime: true,
          executor: true
        },
        onToggleDebugFilter: vi.fn(),
        onCopyDiagnostics: vi.fn(async () => "{}"),
        onRefreshHistory: vi.fn(),
        onResetSettings: vi.fn()
      })
    );

    expect(markup).toContain("Audio &amp; Voice");
    expect(markup).toContain("Local Executor");
    expect(markup).toContain("Interface");
    expect(markup).toContain("Advanced");
    expect(markup).toContain("Gemini CLI needs authentication.");
    expect(markup).toContain("/usr/local/bin/gemini");
    expect(markup).toContain("Copy diagnostics");
    expect(markup).toContain("Cmd/Ctrl + Shift + D opens Developer Console");
  });
});
