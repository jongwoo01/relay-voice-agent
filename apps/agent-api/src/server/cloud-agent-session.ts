import {
  ActivityHandling,
  Behavior,
  EndSensitivity,
  Modality,
  StartSensitivity,
  Type
} from "@google/genai";
import type {
  AssistantDeliveryPlan,
  ConversationTimelineItem,
  ConversationTurnViewModel,
  Task,
  TaskEvent,
  TaskRunnerViewModel
} from "@agent/shared-types";
import {
  createPostgresSessionPersistence,
  GoogleLiveApiTransport,
  planAssistantNotificationDelivery,
  TextRealtimeSessionLoop,
  type GoogleLiveApiTransportConnectInput,
  type GoogleLiveSessionTransport,
  type SessionPersistence
} from "../index.js";
import type { AssistantMessageListener } from "../modules/realtime/text-realtime-session-loop.js";
import type { SqlClientLike } from "../modules/persistence/postgres-client.js";
import { ConnectedClientExecutor } from "./connected-client-executor.js";
import { NoopLiveSessionController } from "./noop-live-session-controller.js";
import type {
  CloudClientEvent,
  CloudServerEvent,
  HostedConversationStateSnapshot,
  HostedTaskStateSnapshot
} from "./protocol.js";

function nowIso(): string {
  return new Date().toISOString();
}

export interface CloudAgentSessionLoopLike {
  handleDelegateToGeminiCli(
    input: Parameters<TextRealtimeSessionLoop["handleDelegateToGeminiCli"]>[0]
  ): ReturnType<TextRealtimeSessionLoop["handleDelegateToGeminiCli"]>;
  getActiveTaskIntake(
    brainSessionId: string
  ): ReturnType<TextRealtimeSessionLoop["getActiveTaskIntake"]>;
}

export interface CloudAgentLiveTransportLike {
  connect(
    input: GoogleLiveApiTransportConnectInput
  ): Promise<GoogleLiveSessionTransport>;
}

export interface CloudAgentSessionDependencies {
  createPersistence?: (input: {
    brainSessionId: string;
    userId: string;
    sql?: SqlClientLike;
  }) => Promise<SessionPersistence> | SessionPersistence;
  createLoop?: (input: {
    executor: ConnectedClientExecutor;
    persistence: SessionPersistence;
    onAssistantMessage: AssistantMessageListener | undefined;
  }) => Promise<CloudAgentSessionLoopLike> | CloudAgentSessionLoopLike;
  liveTransport?: CloudAgentLiveTransportLike;
  now?: () => string;
}

function createDelegateToGeminiCliTool() {
  return {
    functionDeclarations: [
      {
        name: "delegate_to_gemini_cli",
        description:
          "Delegate local machine work, task follow-up, or task status checks to the connected desktop runtime.",
        behavior: Behavior.NON_BLOCKING,
        parameters: {
          type: Type.OBJECT,
          properties: {
            request: {
              type: Type.STRING,
              description:
                "Natural-language request to pass to the connected desktop runtime."
            },
            taskId: {
              type: Type.STRING
            },
            mode: {
              type: Type.STRING
            }
          },
          required: ["request"]
        }
      }
    ]
  };
}

function createPersonaInstruction(): string {
  return [
    "You are Desktop Companion, a desktop voice assistant.",
    "The desktop app provides microphone, speaker, UI, and local executor access.",
    "All agent logic, task state, and follow-up policy are owned by the server.",
    "Never claim local work succeeded unless it was confirmed by delegate_to_gemini_cli.",
    "When local-machine work, task follow-up, or task status is needed, call delegate_to_gemini_cli.",
    "Do not invent local files, browser tabs, app state, or task results."
  ].join(" ");
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

function buildTaskRunner(task: Task, latestEvent?: TaskEvent): TaskRunnerViewModel {
  return {
    taskId: task.id,
    label: `Task ${task.id.slice(-4)}`,
    title: task.title,
    status: task.status,
    progressSummary: latestEvent?.message ?? task.completionReport?.summary,
    blockingReason:
      task.status === "waiting_input" || task.status === "approval_required"
        ? latestEvent?.message
        : undefined,
    lastUpdatedAt: task.updatedAt
  };
}

function summarizeRuntimeContext(snapshot: HostedTaskStateSnapshot): string {
  const activeTasks = snapshot.tasks.map(
    (task: Task) => `${task.title} (${task.status})`
  );
  const intake = snapshot.intake.active
    ? `Intake: ${snapshot.intake.workingText || snapshot.intake.lastQuestion || "active"}`
    : "Intake: none";
  return [intake, `Active tasks: ${activeTasks.join(", ") || "none"}`].join("\n");
}

export class CloudAgentSession {
  private readonly persistencePromise: Promise<SessionPersistence>;
  private readonly executor: ConnectedClientExecutor;
  private readonly loopPromise: Promise<CloudAgentSessionLoopLike>;
  private readonly liveTransport: CloudAgentLiveTransportLike;
  private readonly now: () => string;
  private liveSession: GoogleLiveSessionTransport | null = null;
  private readonly notifications: AssistantDeliveryPlan[] = [];
  private readonly pendingToolContinuations = new Map<string, string>();
  private readonly conversationState: HostedConversationStateSnapshot = {
    connected: false,
    connecting: false,
    status: "idle",
    muted: false,
    error: null,
    routing: {
      mode: "idle",
      summary: "아직 확인 중인 요청이 없습니다.",
      detail: ""
    },
    conversationTimeline: [],
    conversationTurns: [],
    activeTurnId: null,
    inputPartial: "",
    lastUserTranscript: "",
    outputTranscript: ""
  };
  private turnSequence = 0;

  constructor(
    private readonly input: {
      brainSessionId: string;
      userId: string;
      sql?: SqlClientLike;
      send: (event: CloudServerEvent) => void;
      onClose?: () => void;
    },
    dependencies: CloudAgentSessionDependencies = {}
  ) {
    this.now = dependencies.now ?? nowIso;
    const createPersistence =
      dependencies.createPersistence ??
      ((params: {
        brainSessionId: string;
        userId: string;
        sql?: SqlClientLike;
      }) =>
        createPostgresSessionPersistence({
          sql: params.sql,
          ensureBrainSession: {
            brainSessionId: params.brainSessionId,
            userId: params.userId,
            source: "live",
            now: this.now()
          }
        }));
    this.persistencePromise = Promise.resolve(
      createPersistence({
        brainSessionId: input.brainSessionId,
        userId: input.userId,
        sql: input.sql
      })
    );
    this.executor = new ConnectedClientExecutor(async (request) => {
      this.input.send({
        type: "executor_request",
        request
      });
    });
    const createLoop =
      dependencies.createLoop ??
      ((params: {
        executor: ConnectedClientExecutor;
        persistence: SessionPersistence;
        onAssistantMessage: AssistantMessageListener | undefined;
      }) =>
        new TextRealtimeSessionLoop(
          params.executor,
          params.persistence,
          params.onAssistantMessage
        ));
    this.loopPromise = this.persistencePromise.then(async (persistence) =>
      createLoop({
        executor: this.executor,
        persistence,
        onAssistantMessage: async (notification) => {
          const plan = planAssistantNotificationDelivery(notification, {
            userSpeaking: false,
            assistantSpeaking: false
          });
          this.notifications.push(plan);
          if (this.notifications.length > 40) {
            this.notifications.shift();
          }
          if (notification.message.taskId) {
            await this.flushPendingToolContinuation(notification.message.taskId);
          }
          await this.broadcastTaskState();
        }
      })
    );
    this.liveTransport =
      dependencies.liveTransport ??
      new GoogleLiveApiTransport(new NoopLiveSessionController());
  }

  async start(): Promise<void> {
    if (this.liveSession || this.conversationState.connecting) {
      return;
    }

    this.conversationState.connecting = true;
    this.conversationState.status = "connecting";
    this.input.send({
      type: "conversation_state",
      state: this.getConversationState()
    });

    this.liveSession = await this.liveTransport.connect({
      brainSessionId: this.input.brainSessionId,
      model: process.env.LIVE_MODEL?.trim() || undefined,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: {
          thinkingBudget: 0
        },
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 240,
            silenceDurationMs: 100
          }
        },
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Zephyr"
            }
          }
        },
        tools: [createDelegateToGeminiCliTool()],
        systemInstruction: createPersonaInstruction()
      },
      callbacks: {
        onopen: () => {
          this.conversationState.connected = true;
          this.conversationState.connecting = false;
          this.conversationState.status = "listening";
          this.conversationState.error = null;
          this.input.send({
            type: "conversation_state",
            state: this.getConversationState()
          });
        },
        onclose: (info) => {
          this.conversationState.connected = false;
          this.conversationState.connecting = false;
          this.conversationState.status = "idle";
          this.conversationState.error = info.reason ? `closed: ${info.reason}` : null;
          this.liveSession = null;
          this.input.send({
            type: "conversation_state",
            state: this.getConversationState()
          });
        },
        onerror: (error) => {
          this.conversationState.status = "error";
          this.conversationState.error = normalizeError(error);
          this.input.send({
            type: "error",
            message: this.conversationState.error
          });
          this.input.send({
            type: "conversation_state",
            state: this.getConversationState()
          });
        },
        onevent: async (event) => {
          await this.handleLiveEvent(event);
        }
      }
    });

    this.input.send({
      type: "session_ready",
      brainSessionId: this.input.brainSessionId,
      conversation: this.getConversationState(),
      tasks: await this.buildTaskState()
    });
  }

  async handleClientEvent(event: CloudClientEvent): Promise<void> {
    if (!this.liveSession && event.type !== "ping") {
      throw new Error("Live session is not ready");
    }

    switch (event.type) {
      case "typed_turn":
        await this.handleTypedTurn(event.text);
        break;
      case "audio_chunk":
        this.liveSession?.sendRealtimeAudio(event.data, event.mimeType);
        break;
      case "audio_stream_end":
        this.liveSession?.sendAudioStreamEnd();
        break;
      case "executor_progress":
        await this.executor.recordProgress(event.runId, event.event);
        await this.broadcastTaskState();
        break;
      case "executor_terminal":
        this.executor.completeRun({
          runId: event.runId,
          ok: event.ok,
          result: event.result,
          error: event.error
        });
        await this.broadcastTaskState();
        break;
      case "ping":
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        break;
      case "auth":
        break;
      default:
        break;
    }
  }

  async close(): Promise<void> {
    this.liveSession?.close();
    this.liveSession = null;
    this.executor.failAll("Desktop client disconnected");
    this.input.onClose?.();
  }

  private async handleTypedTurn(text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText || !this.liveSession) {
      return;
    }

    const createdAt = this.now();
    const turnId = this.createUserTurn("typed", normalizedText, createdAt);
    this.conversationState.activeTurnId = turnId;
    this.conversationState.status = "thinking";
    this.conversationState.lastUserTranscript = normalizedText;
    this.conversationState.outputTranscript = "";

    const persistence = await this.persistencePromise;
    await persistence.conversationRepository.save({
      brainSessionId: this.input.brainSessionId,
      speaker: "user",
      text: normalizedText,
      createdAt
    });

    this.liveSession.sendText(normalizedText, true);
    this.input.send({
      type: "conversation_state",
      state: this.getConversationState()
    });
  }

  private async handleLiveEvent(event: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (event.type) {
      case "output_audio":
        this.input.send({
          type: "live_output_audio_chunk",
          data: String(event.data ?? ""),
          mimeType: String(event.mimeType ?? "audio/pcm")
        });
        return;
      case "output_transcription":
        this.applyAssistantTranscript(
          String(event.text ?? ""),
          Boolean(event.finished)
        );
        this.input.send({
          type: "live_output_transcript",
          text: this.conversationState.outputTranscript,
          finished: Boolean(event.finished)
        });
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        if (event.finished) {
          const persistence = await this.persistencePromise;
          const text = this.conversationState.outputTranscript.trim();
          if (text) {
            await persistence.conversationRepository.save({
              brainSessionId: this.input.brainSessionId,
              speaker: "assistant",
              text,
              createdAt: this.now(),
              tone: "reply"
            });
          }
        }
        return;
      case "input_transcription_partial":
        this.conversationState.inputPartial = String(event.text ?? "");
        this.conversationState.status = "listening";
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        return;
      case "input_transcription_final":
        await this.handleVoiceTranscriptFinal(String(event.text ?? ""));
        return;
      case "waiting_for_input":
        this.conversationState.status = "listening";
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        return;
      case "turn_complete":
        this.finalizeActiveTurn("completed");
        this.conversationState.status = "listening";
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        return;
      case "interrupted":
        this.finalizeActiveTurn("completed", true);
        this.conversationState.status = "interrupted";
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        return;
      case "tool_call":
        await this.handleToolCall(
          Array.isArray(event.functionCalls) ? event.functionCalls : []
        );
        return;
      default:
        return;
    }
  }

  private async handleVoiceTranscriptFinal(text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const createdAt = this.now();
    const turnId = this.createUserTurn("voice", normalizedText, createdAt);
    this.conversationState.activeTurnId = turnId;
    this.conversationState.inputPartial = "";
    this.conversationState.lastUserTranscript = normalizedText;
    this.conversationState.status = "thinking";

    const persistence = await this.persistencePromise;
    await persistence.conversationRepository.save({
      brainSessionId: this.input.brainSessionId,
      speaker: "user",
      text: normalizedText,
      createdAt
    });

    this.input.send({
      type: "conversation_state",
      state: this.getConversationState()
    });
  }

  private async handleToolCall(functionCalls: any[]): Promise<void> {
    const loop = await this.loopPromise;
    const functionResponses = [];

    for (const functionCall of functionCalls) {
      if (functionCall?.name !== "delegate_to_gemini_cli") {
        functionResponses.push({
          id: functionCall?.id,
          name: functionCall?.name ?? "unknown_tool",
          response: {
            error: `Unsupported live tool: ${functionCall?.name ?? "unknown"}`
          }
        });
        continue;
      }

      const args =
        functionCall?.args && typeof functionCall.args === "object"
          ? functionCall.args
          : {};
      const request =
        typeof args.request === "string" ? args.request.trim() : "";
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const mode = typeof args.mode === "string" ? args.mode : undefined;
      const result = await loop.handleDelegateToGeminiCli({
        brainSessionId: this.input.brainSessionId,
        request,
        taskId,
        mode: mode as "auto" | "new_task" | "resume" | "status" | undefined,
        now: this.now()
      });

      functionResponses.push({
        id: functionCall.id,
        name: "delegate_to_gemini_cli",
        response: {
          output: result
        },
        ...(result.accepted &&
        result.taskId &&
        (result.status === "running" ||
          result.status === "waiting_input" ||
          result.status === "approval_required")
          ? { willContinue: true }
          : {})
      });

      if (
        result.accepted &&
        result.taskId &&
        (result.status === "running" ||
          result.status === "waiting_input" ||
          result.status === "approval_required")
      ) {
        this.pendingToolContinuations.set(result.taskId, functionCall.id);
      } else if (result.taskId) {
        this.pendingToolContinuations.delete(result.taskId);
      }

      const presentation = result.presentation;
      if (
        presentation?.ownership === "runtime" &&
        presentation.allowLiveModelOutput === false &&
        typeof presentation.speechText === "string" &&
        presentation.speechText.trim()
      ) {
        this.injectAssistantMessage(
          presentation.speechText,
          result.status === "waiting_input" || result.status === "approval_required"
            ? "clarify"
            : result.action === "created" || result.action === "resumed"
              ? "task_ack"
              : "reply",
          result.taskId,
          result.status
        );
      }
    }

    this.liveSession?.sendToolResponse({
      functionResponses
    });
    await this.broadcastTaskState();
    this.input.send({
      type: "conversation_state",
      state: this.getConversationState()
    });
  }

  private async flushPendingToolContinuation(taskId: string): Promise<void> {
    const callId = this.pendingToolContinuations.get(taskId);
    if (!callId || !this.liveSession) {
      return;
    }

    this.pendingToolContinuations.delete(taskId);
    const loop = await this.loopPromise;
    const result = await loop.handleDelegateToGeminiCli({
      brainSessionId: this.input.brainSessionId,
      request: "상태 알려줘",
      taskId,
      mode: "status",
      now: this.now()
    });

    this.liveSession.sendToolResponse({
      functionResponses: [
        {
          id: callId,
          name: "delegate_to_gemini_cli",
          response: {
            output: result
          }
        }
      ]
    });

    if (
      result.presentation?.ownership === "runtime" &&
      result.presentation.allowLiveModelOutput === false &&
      result.presentation.speechText
    ) {
      this.injectAssistantMessage(
        result.presentation.speechText,
        "reply",
        result.taskId,
        result.status
      );
      this.input.send({
        type: "conversation_state",
        state: this.getConversationState()
      });
    }
  }

  private createUserTurn(
    inputMode: "typed" | "voice",
    text: string,
    createdAt: string
  ): string {
    const turnId = `turn-${++this.turnSequence}`;
    const userMessageId = `${turnId}:user`;
    this.conversationState.conversationTurns.push({
      turnId,
      inputMode,
      stage: "thinking",
      userMessageId,
      startedAt: createdAt,
      updatedAt: createdAt
    });
    this.conversationState.conversationTimeline.push({
      id: userMessageId,
      turnId,
      kind: "user_message",
      inputMode,
      speaker: "user",
      text,
      partial: false,
      streaming: false,
      interrupted: false,
      responseSource: "live",
      createdAt,
      updatedAt: createdAt
    });
    return turnId;
  }

  private applyAssistantTranscript(text: string, finished: boolean): void {
    const activeTurnId = this.conversationState.activeTurnId ?? `turn-${++this.turnSequence}`;
    if (!this.conversationState.activeTurnId) {
      this.conversationState.conversationTurns.push({
        turnId: activeTurnId,
        inputMode: "voice",
        stage: "responding",
        startedAt: this.now(),
        updatedAt: this.now()
      });
      this.conversationState.activeTurnId = activeTurnId;
    }

    const assistantMessageId = `${activeTurnId}:assistant`;
    const createdAt = this.now();
    const existing = this.conversationState.conversationTimeline.find(
      (item: ConversationTimelineItem) => item.id === assistantMessageId
    );
    const mergedText = finished
      ? text
      : `${existing?.text ?? ""}${text}`.trim();
    const nextItem: ConversationTimelineItem = {
      id: assistantMessageId,
      turnId: activeTurnId,
      kind: "assistant_message",
      inputMode:
        this.conversationState.conversationTurns.find(
          (turn: ConversationTurnViewModel) => turn.turnId === activeTurnId
        )
          ?.inputMode ?? "voice",
      speaker: "assistant",
      text: mergedText,
      partial: !finished,
      streaming: !finished,
      interrupted: false,
      tone: "reply",
      responseSource: "live",
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt: createdAt
    };

    this.conversationState.outputTranscript = mergedText;
    this.upsertTimelineItem(nextItem);
    this.upsertTurn({
      turnId: activeTurnId,
      inputMode: nextItem.inputMode,
      stage: finished ? "responding" : "responding",
      assistantMessageId,
      startedAt: existing?.createdAt ?? createdAt,
      updatedAt: createdAt
    });
  }

  private injectAssistantMessage(
    text: string,
    tone: "reply" | "clarify" | "task_ack",
    taskId?: string,
    taskStatus?: Task["status"]
  ): void {
    const activeTurnId = this.conversationState.activeTurnId ?? `turn-${++this.turnSequence}`;
    if (!this.conversationState.activeTurnId) {
      this.conversationState.activeTurnId = activeTurnId;
    }
    const createdAt = this.now();
    const item: ConversationTimelineItem = {
      id: `${activeTurnId}:assistant-runtime:${createdAt}`,
      turnId: activeTurnId,
      kind: "assistant_message",
      inputMode:
        this.conversationState.conversationTurns.find(
          (turn: ConversationTurnViewModel) => turn.turnId === activeTurnId
        )
          ?.inputMode ?? "voice",
      speaker: "assistant",
      text,
      partial: false,
      streaming: false,
      interrupted: false,
      tone,
      taskId,
      taskStatus,
      responseSource: "delegate",
      createdAt,
      updatedAt: createdAt
    };
    this.conversationState.outputTranscript = text;
    this.conversationState.status = "listening";
    this.conversationState.routing = {
      mode: "delegate",
      summary: text,
      detail: taskId ? `task ${taskId} · ${taskStatus ?? "unknown"}` : ""
    };
    this.conversationState.conversationTimeline.push(item);
    this.upsertTurn({
      turnId: activeTurnId,
      inputMode: item.inputMode,
      stage:
        taskStatus === "waiting_input" || taskStatus === "approval_required"
          ? "waiting_input"
          : taskStatus === "failed"
            ? "failed"
            : taskStatus === "completed"
              ? "completed"
              : "delegated",
      assistantMessageId: item.id,
      taskId,
      startedAt: createdAt,
      updatedAt: createdAt
    });
  }

  private finalizeActiveTurn(
    stage: ConversationTurnViewModel["stage"],
    interrupted = false
  ): void {
    const activeTurnId = this.conversationState.activeTurnId;
    if (!activeTurnId) {
      return;
    }

    this.upsertTurn({
      turnId: activeTurnId,
      inputMode:
        this.conversationState.conversationTurns.find(
          (turn: ConversationTurnViewModel) => turn.turnId === activeTurnId
        )
          ?.inputMode ?? "voice",
      stage,
      updatedAt: this.now()
    });
    if (interrupted) {
      const assistantItem = this.conversationState.conversationTimeline.find(
        (item: ConversationTimelineItem) =>
          item.turnId === activeTurnId && item.kind === "assistant_message"
      );
      if (assistantItem) {
        assistantItem.interrupted = true;
        assistantItem.updatedAt = this.now();
      }
    }
    this.conversationState.activeTurnId = null;
  }

  private upsertTimelineItem(nextItem: ConversationTimelineItem): void {
    const index = this.conversationState.conversationTimeline.findIndex(
      (item: ConversationTimelineItem) => item.id === nextItem.id
    );
    if (index >= 0) {
      this.conversationState.conversationTimeline[index] = nextItem;
      return;
    }
    this.conversationState.conversationTimeline.push(nextItem);
  }

  private upsertTurn(nextTurn: ConversationTurnViewModel): void {
    const index = this.conversationState.conversationTurns.findIndex(
      (turn: ConversationTurnViewModel) => turn.turnId === nextTurn.turnId
    );
    if (index >= 0) {
      this.conversationState.conversationTurns[index] = {
        ...this.conversationState.conversationTurns[index],
        ...nextTurn
      };
      return;
    }
    this.conversationState.conversationTurns.push(nextTurn);
  }

  private getConversationState(): HostedConversationStateSnapshot {
    return {
      ...this.conversationState,
      conversationTimeline: [...this.conversationState.conversationTimeline].sort((left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
      conversationTurns: [...this.conversationState.conversationTurns].sort((left, right) =>
        new Date(left.startedAt ?? left.updatedAt ?? "").getTime() -
        new Date(right.startedAt ?? right.updatedAt ?? "").getTime()
      )
    };
  }

  private async buildTaskState(): Promise<HostedTaskStateSnapshot> {
    const persistence = await this.persistencePromise;
    const activeTasks = await persistence.taskRepository.listActiveByBrainSessionId(
      this.input.brainSessionId
    );
    const recentTasks = await persistence.taskRepository.listRecentByBrainSessionId(
      this.input.brainSessionId,
      8
    );
    const taskTimelines = await Promise.all(
      recentTasks.slice(0, 8).map(async (task) => ({
        taskId: task.id,
        events: await persistence.taskEventRepository.listByTaskId(task.id)
      }))
    );
    const intake = await (await this.loopPromise).getActiveTaskIntake(
      this.input.brainSessionId
    );

    const latestEventByTaskId = new Map(
      taskTimelines.map((timeline) => [timeline.taskId, timeline.events.at(-1)])
    );
    const taskRunners = activeTasks.map((task) =>
      buildTaskRunner(task, latestEventByTaskId.get(task.id))
    );
    const mainState =
      activeTasks.some(
        (task) => task.status === "waiting_input" || task.status === "approval_required"
      )
        ? "waiting_user"
        : activeTasks.length > 0
          ? "thinking"
          : this.notifications.length > 0
            ? "briefing"
            : "idle";

    return {
      tasks: activeTasks,
      recentTasks,
      taskTimelines,
      intake: {
        active: Boolean(intake),
        missingSlots: intake?.missingSlots ?? [],
        lastQuestion: intake?.lastQuestion ?? null,
        workingText: intake?.workingText ?? ""
      },
      notifications: {
        delivered: [...this.notifications],
        pending: []
      },
      pendingBriefingCount: 0,
      avatar: {
        mainState,
        taskRunners
      }
    };
  }

  private async broadcastTaskState(): Promise<void> {
    const taskState = await this.buildTaskState();
    if (this.liveSession) {
      this.liveSession.sendContext(summarizeRuntimeContext(taskState));
    }
    this.input.send({
      type: "task_state",
      state: taskState
    });
  }
}
