import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentActivityPanel } from "./AgentActivityPanel.jsx";

globalThis.React = React;
globalThis.window = {
  desktopSystem: {
    platform: "darwin"
  }
};

function entry(taskId: string, status: string) {
  return {
    taskId,
    label: `Task ${taskId}`,
    headline: `Headline ${taskId}`,
    heroSummary: `Summary ${taskId}`,
    latestHumanUpdate: `Latest ${taskId}`,
    status,
    statusLabel:
      status === "completed"
        ? "Completed"
        : status === "running"
        ? "Running"
        : "Waiting for input",
    lastUpdatedAt: "2026-03-15T10:00:00.000Z",
    timeline: [],
    executionTrace: [],
    advancedTrace: [],
    traceCount: 0,
    resultSummary: status === "completed" ? "Finished work" : null,
    detailedAnswer: status === "completed" ? "Detailed result" : null,
    changes: status === "completed" ? ["Changed file"] : []
  };
}

const baseProps = {
  onSelectTask: vi.fn(),
  onCancelTask: vi.fn(),
  taskCancelUiState: {},
  summary: {
    notifications: {
      delivered: [],
      pending: []
    }
  },
  setupStatus: {
    geminiWorkspaceTrust: {
      folderTrustEnabled: true,
      trusted: false
    }
  },
  debugEvents: [],
  voiceConnected: true,
  pendingBriefingCount: 0,
  onDisableGeminiFolderTrust: vi.fn(),
  onTrustGeminiWorkspace: vi.fn(),
  onOpenSupportTarget: vi.fn()
};

describe("AgentActivityPanel", () => {
  it("does not render the old select-a-task prompt when tasks already exist", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [entry("task-1", "running")],
        archivedEntries: [],
        selectedTaskId: null
      })
    );

    expect(markup).toContain("Running (1)");
    expect(markup).not.toContain("Select a Task");
    expect(markup).not.toContain(
      "Click on any task above to view detailed execution traces and results."
    );
  });

  it("promotes completed work when no running tasks remain", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [],
        archivedEntries: [entry("task-1", "completed")],
        selectedTaskId: null
      })
    );

    expect(markup).toContain("Completed (1)");
    expect(markup).toContain("Finished tasks stay openable here");
    expect(markup).not.toContain("Detailed result");
    expect(markup).not.toContain("Running (");
    expect(markup).not.toContain("<details open");
  });

  it("renders a compact stop task action only for active task details", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [entry("task-1", "running")],
        archivedEntries: [entry("task-2", "completed")],
        selectedTaskId: "task-1"
      })
    );

    expect(markup).toContain("Stop task");
    expect(markup).not.toContain("Task task-1");
  });

  it("shows cancelling feedback in the active card without the stop task action", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [entry("task-1", "running")],
        archivedEntries: [],
        selectedTaskId: "task-1",
        taskCancelUiState: {
          "task-1": {
            phase: "cancelling"
          }
        }
      })
    );

    expect(markup).toContain("Cancelling…");
    expect(markup).toContain(
      "Stopping the local runner and waiting for cancellation confirmation."
    );
    expect(markup).not.toContain("Stop task");
  });

  it("keeps a cancelled task visible in Running during the confirmation dwell", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [],
        archivedEntries: [entry("task-1", "cancelled")],
        selectedTaskId: "task-1",
        taskCancelUiState: {
          "task-1": {
            phase: "cancelled_confirmed"
          }
        }
      })
    );

    expect(markup).toContain("Running (1)");
    expect(markup).toContain("The task was cancelled and will move to Completed in a moment.");
    expect(markup).not.toContain("Completed (1)");
  });

  it("shows trust repair actions for Windows trust-related task blockers", () => {
    const previousPlatform = globalThis.window.desktopSystem.platform;
    globalThis.window.desktopSystem.platform = "win32";
    const blocked = {
      ...entry("task-win", "failed"),
      needsUserAction:
        "Gemini CLI Trusted Folders is enabled and this workspace is not trusted."
    };

    const markup = renderToStaticMarkup(
      createElement(AgentActivityPanel, {
        ...baseProps,
        taskRunners: [],
        archivedEntries: [blocked],
        selectedTaskId: "task-win"
      })
    );

    expect(markup).toContain("Workspace Trust Fix");
    expect(markup).toContain("Disable Trusted Folders");
    expect(markup).toContain("Trust this workspace");
    expect(markup).toContain("Open trustedFolders.json");
    globalThis.window.desktopSystem.platform = previousPlatform;
  });
});
