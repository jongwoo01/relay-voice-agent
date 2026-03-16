import { describe, expect, it } from "vitest";
import { DesktopUiStateStore } from "../src/main/ui/desktop-ui-state.js";

describe("desktop-ui-state", () => {
  it("keeps the chat feed limited to live conversation while preserving task notifications separately", () => {
    const store = new DesktopUiStateStore();

    store.setSessionState({
      brainSessionId: "desktop-session-1",
      executionMode: "gemini",
      executorHealth: {
        status: "unhealthy",
        code: "missing_binary",
        summary: "Gemini CLI is not available locally.",
        detail: "Install Gemini CLI, then retry the health check.",
        checkedAt: "2026-03-13T05:00:00.000Z",
        canRunLocalTasks: false,
        commandPath: "/usr/local/bin/gemini",
        stderrSnippet: "spawn /usr/local/bin/gemini ENOENT"
      },
      mic: { mode: "idle", enabled: true },
      activity: { userSpeaking: false, assistantSpeaking: false },
      input: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
      notifications: {
        delivered: [
          {
            uiText: "Done. I finished cleaning up the desktop.",
            delivery: "immediate",
            reason: "task_completed",
            taskId: "task-1",
            createdAt: "2026-03-13T05:00:02.000Z"
          }
        ],
        pending: []
      },
      pendingBriefingCount: 0,
      tasks: [],
      recentTasks: [{ id: "task-1", title: "Desktop cleanup", status: "completed" }],
      taskTimelines: [],
      taskRunnerDetails: [
        {
          taskId: "task-1",
          title: "Desktop cleanup",
          status: "completed",
          headline: "Desktop cleanup",
          statusLabel: "Completed",
          heroSummary: "Finished cleaning up the desktop.",
          latestHumanUpdate: "Finished cleaning up the desktop.",
          requestSummary: "Clean up my desktop",
          lastUpdatedAt: "2026-03-13T05:00:02.000Z",
          timeline: [
            {
              kind: "request_received",
              title: "Request received",
              body: "Created the task “Desktop cleanup.”",
              createdAt: "2026-03-13T05:00:00.000Z",
              emphasis: "info",
              source: "task"
            }
          ],
          resultSummary: "Finished cleaning up the desktop.",
          verification: "verified",
          changes: ["Removed unnecessary files"],
          advancedTrace: []
        }
      ],
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      messages: []
    });
    store.setLiveState({
      connected: true,
      connecting: false,
      status: "listening",
      muted: false,
      error: null,
      activityDetection: {
        mode: "auto",
        source: "server"
      },
      routing: { mode: "idle", summary: "Waiting for the next request.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "Clean up my desktop",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: "2026-03-13T05:00:00.000Z",
          updatedAt: "2026-03-13T05:00:00.000Z"
        },
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
          tone: "reply",
          responseSource: "live",
          createdAt: "2026-03-13T05:00:01.000Z",
          updatedAt: "2026-03-13T05:00:01.000Z"
        }
      ],
      conversationTurns: [
        {
          turnId: "turn-1",
          inputMode: "voice",
          stage: "delegated",
          userMessageId: "turn-1:user",
          assistantMessageId: "turn-1:assistant",
          taskId: "task-1"
        }
      ],
      activeTurnId: null,
      inputPartial: "",
      lastUserTranscript: "Clean up my desktop",
      outputTranscript: ""
    });
    store.appendDebugEvent({
      source: "bridge",
      kind: "decision",
      summary: "voice delegate backend: created running",
      turnId: "turn-1",
      taskId: "task-1",
      createdAt: "2026-03-13T05:00:01.500Z"
    });
    store.setSettings({
      audio: {
        defaultMicId: "mic-1",
        startMuted: true
      },
      executor: {
        enabled: false
      },
      ui: {
        motionPreference: "on",
        showHeaderHealthWarnings: false,
        autoOpenCompletedTasks: false
      },
      debug: {
        defaultFilters: {
          transport: true,
          live: false,
          bridge: true,
          runtime: true,
          executor: false
        }
      }
    });
    store.setSystemState({
      microphonePermissionStatus: "granted"
    });

    const uiState = store.compose();

    expect(uiState.conversationTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "turn-1:user",
          kind: "user_message"
        }),
        expect.objectContaining({
          id: "turn-1:assistant",
          kind: "assistant_message",
          responseSource: "live"
        })
      ])
    );
    expect(uiState.conversationTurns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turnId: "turn-1",
          taskId: "task-1",
          stage: "delegated"
        })
      ])
    );
    expect(uiState.debugInspector.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bridge",
          taskId: "task-1",
          turnId: "turn-1"
        })
      ])
    );
    expect(uiState.taskSummary.taskRunnerDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          statusLabel: "Completed",
          resultSummary: "Finished cleaning up the desktop."
        })
      ])
    );
    expect(uiState.taskSummary.notifications.delivered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          reason: "task_completed"
        })
      ])
    );
    expect(uiState.executorHealth).toEqual(
      expect.objectContaining({
        status: "unhealthy",
        code: "missing_binary",
        canRunLocalTasks: false
      })
    );
    expect(uiState.voiceControlState.activityDetection).toEqual({
      mode: "auto",
      source: "server"
    });
    expect(uiState.settings).toEqual(
      expect.objectContaining({
        audio: expect.objectContaining({
          defaultMicId: "mic-1",
          startMuted: true
        }),
        executor: expect.objectContaining({
          enabled: false
        })
      })
    );
    expect(uiState.systemStatus).toEqual({
      microphonePermissionStatus: "granted"
    });
  });

  it("keeps bubble order stable inside a turn when timestamps collide", () => {
    const store = new DesktopUiStateStore();
    const sharedTimestamp = "2026-03-13T05:10:00.000Z";

    store.setSessionState({
      brainSessionId: "desktop-session-1",
      executionMode: "gemini",
      mic: { mode: "idle", enabled: true },
      activity: { userSpeaking: false, assistantSpeaking: false },
      input: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
      notifications: { delivered: [], pending: [] },
      pendingBriefingCount: 0,
      tasks: [],
      recentTasks: [],
      taskTimelines: [],
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      messages: []
    });
    store.setLiveState({
      connected: true,
      connecting: false,
      status: "listening",
      muted: false,
      error: null,
      routing: { mode: "idle", summary: "Waiting for the next request.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:assistant",
          turnId: "turn-1",
          kind: "assistant_message",
          inputMode: "voice",
          speaker: "assistant",
          text: "I'll check right away.",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        },
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "Check my desktop",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        },
        {
          id: "turn-1:task",
          turnId: "turn-1",
          kind: "task_event",
          inputMode: "voice",
          speaker: "system",
          text: "More input is needed.",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: sharedTimestamp,
          updatedAt: sharedTimestamp
        }
      ],
      conversationTurns: [
        {
          turnId: "turn-1",
          inputMode: "voice",
          stage: "waiting_input",
          userMessageId: "turn-1:user",
          assistantMessageId: "turn-1:assistant"
        }
      ],
      activeTurnId: null,
      inputPartial: "",
      lastUserTranscript: "Check my desktop",
      outputTranscript: ""
    });

    const uiState = store.compose();

    expect(uiState.conversationTimeline.map((item) => item.id)).toEqual([
      "turn-1:user",
      "turn-1:assistant",
      "turn-1:task"
    ]);
  });

  it("orders turns by their start time instead of a later follow-up timestamp", () => {
    const store = new DesktopUiStateStore();

    store.setSessionState({
      brainSessionId: "desktop-session-1",
      executionMode: "gemini",
      mic: { mode: "idle", enabled: true },
      activity: { userSpeaking: false, assistantSpeaking: false },
      input: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
      notifications: { delivered: [], pending: [] },
      pendingBriefingCount: 0,
      tasks: [],
      recentTasks: [],
      taskTimelines: [],
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      messages: []
    });
    store.setLiveState({
      connected: true,
      connecting: false,
      status: "listening",
      muted: false,
      error: null,
      routing: { mode: "idle", summary: "Waiting for the next request.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "Do the first task",
          partial: false,
          streaming: false,
          interrupted: false,
          taskId: "task-1",
          createdAt: "2026-03-13T05:00:00.000Z",
          updatedAt: "2026-03-13T05:00:00.000Z"
        },
        {
          id: "turn-2:user",
          turnId: "turn-2",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "I have a second question too",
          partial: false,
          streaming: false,
          interrupted: false,
          createdAt: "2026-03-13T05:00:05.000Z",
          updatedAt: "2026-03-13T05:00:05.000Z"
        }
      ],
      conversationTurns: [
        {
          turnId: "turn-1",
          inputMode: "voice",
          stage: "delegated",
          userMessageId: "turn-1:user",
          taskId: "task-1",
          startedAt: "2026-03-13T05:00:00.000Z",
          updatedAt: "2026-03-13T05:00:01.000Z"
        },
        {
          turnId: "turn-2",
          inputMode: "voice",
          stage: "thinking",
          userMessageId: "turn-2:user",
          startedAt: "2026-03-13T05:00:05.000Z",
          updatedAt: "2026-03-13T05:00:05.000Z"
        }
      ],
      activeTurnId: null,
      inputPartial: "",
      lastUserTranscript: "I have a second question too",
      outputTranscript: ""
    });

    const uiState = store.compose();

    expect(uiState.conversationTimeline.map((item) => item.id)).toEqual([
      "turn-1:user",
      "turn-2:user"
    ]);
  });

  it("exposes persisted judge history summaries in the composed UI state", () => {
    const store = new DesktopUiStateStore();

    store.setHistoryState({
      loading: false,
      error: null,
      sessions: [
        {
          brainSessionId: "judge-session-1",
          status: "closed",
          source: "live",
          createdAt: "2026-03-13T05:00:00.000Z",
          updatedAt: "2026-03-13T05:10:00.000Z",
          closedAt: "2026-03-13T05:10:00.000Z",
          lastUserMessage: "Remember my name",
          lastAssistantMessage: "Okay, I'll remember you as Jongwoo.",
          recentTasks: [
            {
              id: "task-1",
              title: "Desktop cleanup",
              status: "completed",
              updatedAt: "2026-03-13T05:09:00.000Z",
              summary: "Finished organizing the desktop files."
            }
          ]
        }
      ]
    });

    const uiState = store.compose();

    expect(uiState.historySummary).toEqual({
      loading: false,
      error: null,
      sessions: [
        expect.objectContaining({
          brainSessionId: "judge-session-1",
          lastAssistantMessage: "Okay, I'll remember you as Jongwoo.",
          recentTasks: [
            expect.objectContaining({
              id: "task-1",
              title: "Desktop cleanup",
              status: "completed"
            })
          ]
        })
      ]
    });
  });
});
