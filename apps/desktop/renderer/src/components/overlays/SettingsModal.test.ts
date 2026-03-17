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
    openMicrophonePrivacySettings: vi.fn(),
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
            voiceCaptureEnabled: true,
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
        setupStatus: {
          checkedAt: "2026-03-16T00:00:00.000Z",
          hostedBackend: {
            status: "warning",
            summary: "Hosted backend is reachable but not authenticated.",
            detail: "A judge passcode is still required before the live session can start.",
            baseUrl: "https://example.com"
          },
          microphone: {
            status: "ready",
            summary: "Microphone permission is granted.",
            detail: "Relay can request live voice capture on this machine."
          },
          localExecutorBinary: {
            status: "ready",
            summary: "Gemini CLI binary is available.",
            detail: "Relay can invoke the local Gemini CLI binary.",
            commandPath: "/usr/local/bin/gemini",
            commandSource: "path_lookup",
            version: "gemini 1.2.3"
          },
          localExecutorAuth: {
            status: "error",
            summary: "Google login is missing.",
            detail: "Relay found Gemini CLI but the cached Google login required for headless use is not ready.",
            selectedAuthType: "oauth-personal",
            envFilePresent: false
          },
          localFileAccess: {
            status: "warning",
            summary: "Some local folders are not readable by the app process.",
            detail: "Relay should be able to inspect local files, but one or more common folders failed a direct access probe.",
            probeSource: "app_process",
            directories: [
              {
                key: "desktop",
                label: "Desktop",
                path: "/Users/jongwoo/Desktop",
                status: "granted"
              }
            ]
          },
          currentWorkspaceTrust: {
            status: "ready",
            summary: "Current workspace is covered by Gemini trusted folders.",
            detail: "Gemini CLI should treat the current task workspace as trusted for local operations.",
            workspacePath: "/Users/jongwoo/Desktop/projects/gemini_live_agent",
            matchedTrustedPath: "/Users/jongwoo"
          }
        },
        setupStatusLoading: false,
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
        onRefreshSetupStatus: vi.fn(),
        onRequestMicrophoneAccess: vi.fn(),
        onMicrophoneEnabledChange: vi.fn(),
        onStartMutedChange: vi.fn(),
        onExecutorEnabledChange: vi.fn(),
        onRetryExecutorHealthCheck: vi.fn(),
        onMotionPreferenceChange: vi.fn(),
        onHeaderHealthWarningsChange: vi.fn(),
        onCopyText: vi.fn(async () => "gemini --version"),
        onOpenGeminiLoginTerminal: vi.fn(),
        onOpenDeveloperConsole: vi.fn(),
        onOpenSupportTarget: vi.fn(),
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

    expect(markup).toContain("Setup Status");
    expect(markup).toContain("Audio &amp; Voice");
    expect(markup).toContain("Local Executor");
    expect(markup).toContain("Interface");
    expect(markup).toContain("Advanced");
    expect(markup).toContain("Gemini CLI needs authentication.");
    expect(markup).toContain("/usr/local/bin/gemini");
    expect(markup).toContain("Open Terminal for gemini login");
    expect(markup).toContain("Use microphone in hosted sessions");
    expect(markup).toContain("Reset all local settings");
    expect(markup).toContain("Copy diagnostics");
    expect(markup).toContain("Cmd/Ctrl + Shift + D opens Developer Console");
  });
});
