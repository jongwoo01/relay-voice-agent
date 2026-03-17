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
          summary: "Gemini CLI authentication is not ready.",
          detail: "Gemini CLI could not authenticate with the current local auth path. Check login or configured credentials, then retry.",
          checkedAt: "2026-03-16T00:00:00.000Z",
          commandPath: "/usr/local/bin/gemini",
          authStrategy: "cached_google",
          exitCode: 1,
          probeWorkingDirectory: "/Users/jongwoo/Desktop/projects/gemini_live_agent",
          stdoutSnippet: "{\"response\":\"LOGIN\"}"
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
    expect(markup).toContain("Gemini CLI authentication is not ready.");
    expect(markup).toContain("/usr/local/bin/gemini");
    expect(markup).toContain("Open Terminal for gemini login");
    expect(markup).toContain("Use microphone in hosted sessions");
    expect(markup).toContain("Reset all local settings");
    expect(markup).toContain("Copy diagnostics");
    expect(markup).toContain("Cmd/Ctrl + Shift + D opens Developer Console");
  });

  it("hides the microphone privacy shortcut until access has been denied or restricted", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsModal, {
        open: true,
        onClose: vi.fn(),
        settings: {
          audio: {
            defaultMicId: "",
            voiceCaptureEnabled: true,
            startMuted: false
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
          microphonePermissionStatus: "not-determined"
        },
        setupStatus: {
          ...{
            checkedAt: null,
            hostedBackend: { status: "unknown", summary: "", detail: "" },
            microphone: { status: "warning", summary: "", detail: "" },
            localExecutorBinary: { status: "unknown", summary: "", detail: "" },
            localFileAccess: { status: "unknown", summary: "", detail: "", directories: [] }
          }
        },
        setupStatusLoading: false,
        microphones: [],
        selectedMicId: "",
        selectedMicrophoneLabel: "Default input",
        executionMode: "gemini",
        executorHealth: {
          status: "unknown",
          code: null,
          summary: "Gemini CLI health has not been checked yet.",
          detail: "Relay can run a lightweight Gemini CLI probe and show the result here.",
          checkedAt: null,
          commandPath: null
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
        onCopyText: vi.fn(async () => ""),
        onOpenGeminiLoginTerminal: vi.fn(),
        onOpenDeveloperConsole: vi.fn(),
        onOpenSupportTarget: vi.fn(),
        debugFilters: {
          transport: true,
          live: true,
          bridge: true,
          runtime: true,
          executor: true
        },
        onToggleDebugFilter: vi.fn(),
        onCopyDiagnostics: vi.fn(async () => "{}"),
        onRefreshHistory: vi.fn(),
        onResetSettings: vi.fn()
      })
    );

    expect(markup).toContain("Request microphone access");
    expect((markup.match(/Open Privacy Settings/g) ?? []).length).toBe(1);
  });
});
