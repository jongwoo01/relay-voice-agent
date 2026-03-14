import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn()
}));

vi.mock("../execution/local-execution-layer.js", () => ({
  createLocalExecutionLayer: vi.fn(() => ({
    mode: "mock",
    debug: {
      enabled: false,
      rawEvents: []
    },
    executor: {
      run: runMock
    }
  }))
}));

import { CloudSessionClient } from "./cloud-session-client.js";

function createConversationState(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
    connecting: false,
    status: "listening",
    muted: false,
    error: null,
    routing: {
      mode: "idle",
      summary: "",
      detail: ""
    },
    conversationTimeline: [],
    conversationTurns: [],
    activeTurnId: null,
    inputPartial: "",
    lastUserTranscript: "",
    outputTranscript: "",
    ...overrides
  };
}

function createTaskState() {
  return {
    tasks: [],
    recentTasks: [],
    taskTimelines: [],
    taskRunnerDetails: [],
    intake: {
      active: false,
      missingSlots: [],
      lastQuestion: null,
      workingText: ""
    },
    notifications: {
      delivered: [],
      pending: []
    },
    pendingBriefingCount: 0,
    avatar: {
      mainState: "idle",
      taskRunners: []
    }
  };
}

function createHistoryState() {
  return {
    sessions: [
      {
        brainSessionId: "brain-history-1",
        status: "closed",
        source: "live",
        createdAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:05:00.000Z",
        closedAt: "2026-03-14T00:05:00.000Z",
        lastUserMessage: "Read my desktop",
        lastAssistantMessage: "Okay, I'll check right away.",
        recentTasks: []
      }
    ]
  };
}

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  private readonly listeners = new Map<string, Array<(payload?: any) => void>>();
  readonly sent: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.emit("open");
    });
  }

  addEventListener(type: string, listener: (payload?: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string) {
    const parsed = JSON.parse(String(payload));
    this.sent.push(parsed);
    if (parsed?.type === "end_session") {
      queueMicrotask(() => {
        this.close();
      });
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  emit(type: string, payload?: any) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(payload);
    }
  }

  emitMessage(payload: unknown) {
    this.emit("message", {
      data: JSON.stringify(payload)
    });
  }
}

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error("Timed out waiting for condition");
}

describe("CloudSessionClient", () => {
  beforeEach(() => {
    runMock.mockReset();
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/judge/history")) {
        return {
          ok: true,
          json: async () => createHistoryState()
        };
      }

      return {
        ok: true,
        json: async () => ({
          token: "judge-token",
          brainSessionId: "brain-1",
          wsUrl: "ws://judge-host/ws"
        })
      };
    }));
  });

  it("executes remote executor requests through the local worker and sends terminal events back", async () => {
    runMock.mockImplementation(async (request: any, onProgress?: (event: unknown) => Promise<void>) => {
      await onProgress?.({
        taskId: request.task.id,
        type: "executor_progress",
        message: "Task is running",
        createdAt: request.now
      });
      return {
        progressEvents: [],
        completionEvent: {
          taskId: request.task.id,
          type: "executor_completed",
          message: "Completed",
          createdAt: request.now
        },
        outcome: "completed",
        report: {
          summary: "Finished cleanup.",
          verification: "verified",
          changes: ["Cleanup completed"]
        }
      };
    });

    const conversationStates: Array<Record<string, unknown>> = [];
    const taskStates: unknown[] = [];
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host",
      onConversationState: async (state: Record<string, unknown>) => {
        conversationStates.push(state);
      },
      onTaskState: async (state: unknown) => {
        taskStates.push(state);
      }
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    expect(socket.sent).toContainEqual({
      type: "auth",
      token: "judge-token"
    });

    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    await connectPromise;

    socket.emitMessage({
      type: "executor_request",
      request: {
        runId: "run-1",
        taskId: "task-1",
        request: {
          task: {
            id: "task-1",
            title: "Desktop cleanup",
            normalizedGoal: "Desktop cleanup",
            status: "running",
            createdAt: "2026-03-14T00:00:00.000Z",
            updatedAt: "2026-03-14T00:00:00.000Z"
          },
          now: "2026-03-14T00:00:00.000Z",
          prompt: "Clean up the desktop"
        }
      }
    });
    await waitFor(() =>
      socket.sent.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "executor_terminal"
      )
    );

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Clean up the desktop"
      }),
      expect.any(Function)
    );
    expect(socket.sent).toContainEqual({
      type: "executor_progress",
      runId: "run-1",
      taskId: "task-1",
      event: {
        taskId: "task-1",
        type: "executor_progress",
        message: "Task is running",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    });
    const terminalEvent = socket.sent.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "executor_terminal"
    );
    expect(terminalEvent).toEqual(
      expect.objectContaining({
        type: "executor_terminal",
        runId: "run-1",
        taskId: "task-1",
        ok: true,
        result: expect.objectContaining({
          outcome: "completed",
          report: {
            summary: "Finished cleanup.",
            verification: "verified",
            changes: ["Cleanup completed"]
          }
        })
      })
    );
    expect(taskStates).toHaveLength(1);
    expect(conversationStates.at(-1)?.status).toBe("listening");
  });

  it("surfaces server errors in the client state", async () => {
    runMock.mockResolvedValue({
      progressEvents: [],
      completionEvent: {
        taskId: "task-1",
        type: "executor_completed",
        message: "Completed",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    });

    const conversationStates: Array<Record<string, unknown>> = [];
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host",
      onConversationState: async (state: Record<string, unknown>) => {
        conversationStates.push(state);
      },
      onTaskState: async () => undefined
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];
    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    await connectPromise;

    socket.emitMessage({
      type: "error",
      message: "Hosted session failed"
    });
    await Promise.resolve();

    expect(conversationStates.at(-1)).toEqual(
      expect.objectContaining({
        status: "error",
        error: "Hosted session failed"
      })
    );
  });

  it("does not send late audio events when the hosted session is no longer ready", async () => {
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host",
      onConversationState: async () => undefined,
      onTaskState: async () => undefined
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];
    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    await connectPromise;

    socket.sent.length = 0;
    socket.emitMessage({
      type: "conversation_state",
      state: createConversationState({
        connected: false,
        status: "idle"
      })
    });

    client.sendAudioChunk("AAAA");
    client.endAudioStream();

    expect(socket.sent).toEqual([]);
  });

  it("loads judge history after connect and publishes it", async () => {
    const historyStates: unknown[] = [];
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host",
      onConversationState: async () => undefined,
      onTaskState: async () => undefined,
      onHistoryState: async (state: unknown) => {
        historyStates.push(state);
      }
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];
    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    await connectPromise;

    expect(historyStates.at(-1)).toEqual({
      loading: false,
      error: null,
      sessions: createHistoryState().sessions
    });
  });

  it("emits runtime debug events for intake clarifications from task state", async () => {
    const debugEvents: unknown[] = [];
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host",
      onConversationState: async () => undefined,
      onTaskState: async () => undefined,
      onDebugEvent: async (event: unknown) => {
        debugEvents.push(event);
      }
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];
    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    await connectPromise;

    socket.emitMessage({
      type: "task_state",
      state: {
        ...createTaskState(),
        intake: {
          active: true,
          workingText: "check my desktop and tell me the name and count of folders and files",
          missingSlots: ["scope"],
          lastQuestion: "Tell me what rule or scope to use."
        }
      }
    });
    await Promise.resolve();

    expect(debugEvents).toContainEqual(
      expect.objectContaining({
        source: "runtime",
        kind: "task_intake",
        summary: "Tell me what rule or scope to use."
      })
    );
  });

  it("sends an explicit end_session event before disconnecting", async () => {
    const client = new CloudSessionClient({
      baseUrl: "http://judge-host"
    });

    const connectPromise = client.connect("judge-passcode");
    await waitFor(() => MockWebSocket.instances.length > 0);
    const socket = MockWebSocket.instances[0];

    socket.emitMessage({
      type: "session_ready",
      brainSessionId: "brain-1",
      conversation: createConversationState(),
      tasks: createTaskState()
    });

    await connectPromise;
    socket.sent.length = 0;

    await client.disconnect();

    expect(socket.sent).toContainEqual({
      type: "end_session",
      reason: "user_hangup"
    });
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });
});
