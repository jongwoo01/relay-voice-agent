import { describe, expect, it } from "vitest";
import { DesktopUiStateStore } from "../src/main/ui/desktop-ui-state.js";

describe("desktop-ui-state", () => {
  it("merges live turn timeline with runtime notifications and debug events", () => {
    const store = new DesktopUiStateStore();

    store.setSessionState({
      brainSessionId: "desktop-session-1",
      executionMode: "gemini",
      mic: { mode: "idle", enabled: true },
      activity: { userSpeaking: false, assistantSpeaking: false },
      input: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
      notifications: {
        delivered: [
          {
            uiText: "좋아, 끝냈어. 바탕화면 정리를 마쳤어요.",
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
      recentTasks: [{ id: "task-1", title: "바탕화면 정리", status: "completed" }],
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
      routing: { mode: "idle", summary: "다음 요청을 기다리고 있습니다.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "내 바탕화면 정리해줘",
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
          text: "좋아, 바로 확인해볼게.",
          partial: false,
          streaming: false,
          interrupted: false,
          tone: "task_ack",
          responseSource: "delegate",
          taskId: "task-1",
          taskStatus: "running",
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
      lastUserTranscript: "내 바탕화면 정리해줘",
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
          responseSource: "delegate"
        }),
        expect.objectContaining({
          turnId: "turn-1",
          kind: "assistant_message",
          taskId: "task-1",
          taskStatus: "completed"
        })
      ])
    );
    expect(uiState.conversationTurns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turnId: "turn-1",
          taskId: "task-1",
          stage: "completed"
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
      routing: { mode: "idle", summary: "다음 요청을 기다리고 있습니다.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:assistant",
          turnId: "turn-1",
          kind: "assistant_message",
          inputMode: "voice",
          speaker: "assistant",
          text: "바로 확인할게.",
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
          text: "내 바탕화면 확인해줘",
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
          text: "추가 확인이 필요해.",
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
      lastUserTranscript: "내 바탕화면 확인해줘",
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
      notifications: {
        delivered: [
          {
            uiText: "좋아, 첫 번째 작업을 끝냈어.",
            delivery: "immediate",
            reason: "task_completed",
            taskId: "task-1",
            createdAt: "2026-03-13T05:00:10.000Z"
          }
        ],
        pending: []
      },
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
      routing: { mode: "idle", summary: "다음 요청을 기다리고 있습니다.", detail: "" },
      conversationTimeline: [
        {
          id: "turn-1:user",
          turnId: "turn-1",
          kind: "user_message",
          inputMode: "voice",
          speaker: "user",
          text: "첫 번째 작업 해줘",
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
          text: "두 번째 질문도 있어",
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
      lastUserTranscript: "두 번째 질문도 있어",
      outputTranscript: ""
    });

    const uiState = store.compose();

    expect(uiState.conversationTimeline.map((item) => item.id)).toEqual([
      "turn-1:user",
      "turn-1:assistant:task_completed:2026-03-13T05:00:10.000Z",
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
          lastUserMessage: "내 이름 기억해줘",
          lastAssistantMessage: "좋아, 종우라고 기억할게.",
          recentTasks: [
            {
              id: "task-1",
              title: "바탕화면 정리",
              status: "completed",
              updatedAt: "2026-03-13T05:09:00.000Z",
              summary: "바탕화면 파일 정리를 마쳤습니다."
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
          lastAssistantMessage: "좋아, 종우라고 기억할게.",
          recentTasks: [
            expect.objectContaining({
              id: "task-1",
              title: "바탕화면 정리",
              status: "completed"
            })
          ]
        })
      ]
    });
  });
});
