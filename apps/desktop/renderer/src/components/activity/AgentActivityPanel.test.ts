import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentActivityPanel } from "./AgentActivityPanel.jsx";

globalThis.React = React;

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
  summary: {
    notifications: {
      delivered: [],
      pending: []
    }
  },
  debugEvents: [],
  voiceConnected: true,
  pendingBriefingCount: 0,
  completedDrawerAutoOpenTick: 0
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
    expect(markup).toContain("Completed Task");
    expect(markup).not.toContain("Running (");
  });
});
