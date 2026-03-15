import {
  ActivityHandling,
  Behavior,
  EndSensitivity,
  FunctionResponseScheduling,
  Modality,
  StartSensitivity,
  Type
} from "@google/genai";
import type {
  AssistantDeliveryPlan,
  ConversationTimelineItem,
  ConversationTurnViewModel,
  Task,
  TaskExecutionArtifact,
  TaskEvent,
  TaskRunnerDetailViewModel,
  TaskRunnerTimelineEntry,
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
import { mergeStreamingTranscript } from "../modules/live/transcript-merge.js";
import {
  createSessionMemoryService,
  type SessionMemoryServiceLike
} from "../modules/memory/session-memory-service.js";
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

function supportsExplicitVadSignal(): boolean {
  // Gemini Developer API live currently rejects the setup-level explicitVadSignal flag.
  // Keep this capability gate centralized so the transport can opt in later if backend support changes.
  return false;
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
  sessionMemoryService?: SessionMemoryServiceLike;
  profileMemoryService?: SessionMemoryServiceLike;
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

function createSessionResumptionConfig(resumeHandle?: string): { handle?: string } {
  if (resumeHandle?.trim()) {
    return {
      handle: resumeHandle.trim()
    };
  }

  return {};
}

function createContextWindowCompressionConfig(): {
  triggerTokens?: string;
  slidingWindow: { targetTokens?: string };
} {
  const triggerTokens = process.env.LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS?.trim();
  const targetTokens = process.env.LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS?.trim();

  return {
    ...(triggerTokens ? { triggerTokens } : {}),
    slidingWindow: {
      ...(targetTokens ? { targetTokens } : {})
    }
  };
}

function createPersonaInstruction(): string {
  return [
    "You are Desktop Companion, a desktop voice assistant.",
    "The desktop app provides microphone, speaker, UI, and local executor access.",
    "All agent logic, task state, and follow-up policy are owned by the server.",
    "Runtime context may include session memory supplied by the server.",
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

function formatTaskRunnerStatusLabel(status: Task["status"]): string {
  switch (status) {
    case "created":
    case "queued":
      return "Preparing";
    case "running":
      return "Running";
    case "waiting_input":
      return "Waiting for input";
    case "approval_required":
      return "Waiting for approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function toHumanProgressCopy(message: string): string {
  if (message.startsWith("Tool requested: ")) {
    return `Checking the required tool. ${message.slice("Tool requested: ".length)}`;
  }

  if (message.startsWith("Tool finished: ")) {
    return `Finished checking the tool. ${message.slice("Tool finished: ".length)}`;
  }

  if (message === "Task is running") {
    return "Execution has started and progress updates are coming in.";
  }

  return message;
}

function buildTaskHeroSummary(
  task: Task,
  latestEvent?: TaskEvent,
  notification?: AssistantDeliveryPlan
): string {
  const latestMessage =
    latestEvent?.type === "executor_progress"
      ? toHumanProgressCopy(latestEvent.message)
      : latestEvent?.message;

  if (task.status === "waiting_input" || task.status === "approval_required") {
    return latestMessage ?? "This task needs user input before it can continue.";
  }

  if (task.status === "completed") {
    return (
      task.completionReport?.summary ??
      notification?.uiText ??
      latestMessage ??
      "The task is complete."
    );
  }

  if (task.status === "failed") {
    return latestMessage ?? "The task needs attention before it can continue.";
  }

  return (
    latestMessage ??
    notification?.uiText ??
    "Reviewing the request and moving through the task step by step."
  );
}

function createTimelineEntry(
  kind: TaskRunnerTimelineEntry["kind"],
  title: string,
  body: string,
  createdAt: string,
  emphasis: TaskRunnerTimelineEntry["emphasis"],
  source: TaskRunnerTimelineEntry["source"]
): TaskRunnerTimelineEntry {
  return {
    kind,
    title,
    body,
    createdAt,
    emphasis,
    source
  };
}

function toTimelineEntry(task: Task, event: TaskEvent): TaskRunnerTimelineEntry | null {
  switch (event.type) {
    case "task_created":
      return createTimelineEntry(
        "request_received",
        "Request received",
        `Created the task “${task.title}.”`,
        event.createdAt,
        "info",
        "task"
      );
    case "task_queued":
      return createTimelineEntry(
        "runner_preparing",
        "Task runner prepared",
        "The execution plan is ready and the task runner is set up.",
        event.createdAt,
        "normal",
        "task"
      );
    case "task_started":
      return createTimelineEntry(
        "execution_dispatched",
        "Execution dispatched",
        "Execution has started and the runner is waiting for progress updates.",
        event.createdAt,
        "info",
        "executor"
      );
    case "executor_progress":
      return createTimelineEntry(
        "progress_update",
        "Progress update",
        toHumanProgressCopy(event.message),
        event.createdAt,
        "normal",
        "executor"
      );
    case "executor_waiting_input":
      return createTimelineEntry(
        "needs_input",
        "Needs input",
        event.message,
        event.createdAt,
        "warning",
        "system"
      );
    case "executor_approval_required":
      return createTimelineEntry(
        "needs_approval",
        "Needs approval",
        event.message,
        event.createdAt,
        "warning",
        "system"
      );
    case "executor_completed":
      return createTimelineEntry(
        "completion_received",
        "Completion received",
        event.message,
        event.createdAt,
        "success",
        "executor"
      );
    case "executor_failed":
      return createTimelineEntry(
        "failure",
        "Execution issue",
        event.message,
        event.createdAt,
        "error",
        "system"
      );
    default:
      return null;
  }
}

function buildTaskRunnerTimeline(
  task: Task,
  events: TaskEvent[]
): TaskRunnerTimelineEntry[] {
  const entries = events
    .map((event) => toTimelineEntry(task, event))
    .filter((entry): entry is TaskRunnerTimelineEntry => entry !== null);

  if (!entries.some((entry) => entry.kind === "request_received")) {
    entries.unshift(
      createTimelineEntry(
        "request_received",
        "Request received",
        `Turned “${task.title}” into a tracked task.`,
        task.createdAt,
        "info",
        "task"
      )
    );
  }

  if (task.completionReport?.summary) {
    entries.push(
      createTimelineEntry(
        "final_summary",
        "Final summary",
        task.completionReport.summary,
        task.updatedAt,
        task.completionReport.verification === "verified" ? "success" : "info",
        "system"
      )
    );
  }

  const deduped: TaskRunnerTimelineEntry[] = [];
  for (const entry of entries) {
    const previous = deduped.at(-1);
    if (
      previous &&
      previous.kind === entry.kind &&
      previous.title === entry.title &&
      previous.body === entry.body
    ) {
      continue;
    }
    deduped.push(entry);
  }

  return deduped.sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function buildTaskRunner(task: Task, latestEvent?: TaskEvent): TaskRunnerViewModel {
  const statusLabel = formatTaskRunnerStatusLabel(task.status);
  const latestHumanUpdate = buildTaskHeroSummary(task, latestEvent);

  return {
    taskId: task.id,
    label: `Task ${task.id.slice(-4)}`,
    title: task.title,
    status: task.status,
    headline: task.title,
    statusLabel,
    latestHumanUpdate,
    needsUserAction:
      task.status === "waiting_input" || task.status === "approval_required"
        ? latestEvent?.message
        : undefined,
    progressSummary: latestEvent?.message ?? task.completionReport?.summary,
    blockingReason:
      task.status === "waiting_input" || task.status === "approval_required"
        ? latestEvent?.message
        : undefined,
    lastUpdatedAt: task.updatedAt
  };
}

function buildTaskRunnerDetail(
  task: Task,
  events: TaskEvent[],
  executionTrace: TaskExecutionArtifact[],
  notification?: AssistantDeliveryPlan,
  requestSummary?: string
): TaskRunnerDetailViewModel {
  const latestEvent = events.at(-1);
  const latestHumanUpdate = buildTaskHeroSummary(task, latestEvent, notification);

  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    headline: task.title,
    statusLabel: formatTaskRunnerStatusLabel(task.status),
    heroSummary: latestHumanUpdate,
    latestHumanUpdate,
    needsUserAction:
      task.status === "waiting_input" || task.status === "approval_required"
        ? task.completionReport?.question ?? latestEvent?.message
        : undefined,
    requestSummary,
    lastUpdatedAt: task.updatedAt,
    timeline: buildTaskRunnerTimeline(task, events),
    resultSummary: task.completionReport?.summary,
    detailedAnswer: task.completionReport?.detailedAnswer,
    keyFindings: task.completionReport?.keyFindings ?? [],
    verification: task.completionReport?.verification,
    changes: task.completionReport?.changes ?? [],
    question: task.completionReport?.question,
    executionTrace,
    advancedTrace: []
  };
}

function summarizeRuntimeContext(snapshot: HostedTaskStateSnapshot): string {
  const activeTasks = snapshot.tasks.map(
    (task: Task) => `${task.title} (${task.status})`
  );
  const intake = snapshot.intake.active
    ? `Intake: ${snapshot.intake.workingText || snapshot.intake.lastQuestion || "active"}`
    : "Intake: none";
  const latestCompleted = snapshot.recentTasks.find(
    (task) => task.status === "completed" && task.completionReport
  );
  const latestCompletedContext = latestCompleted?.completionReport
    ? [
        `Latest completed task: ${latestCompleted.title}`,
        latestCompleted.completionReport.detailedAnswer
          ? `Detailed result: ${latestCompleted.completionReport.detailedAnswer}`
          : null,
        latestCompleted.completionReport.keyFindings?.length
          ? `Key findings: ${latestCompleted.completionReport.keyFindings.join("; ")}`
          : null
      ]
        .filter(Boolean)
        .join("\n")
    : null;
  return [intake, `Active tasks: ${activeTasks.join(", ") || "none"}`, latestCompletedContext]
    .filter(Boolean)
    .join("\n");
}

export class CloudAgentSession {
  private readonly persistencePromise: Promise<SessionPersistence>;
  private readonly executor: ConnectedClientExecutor;
  private readonly loopPromise: Promise<CloudAgentSessionLoopLike>;
  private readonly liveTransport: CloudAgentLiveTransportLike;
  private readonly sessionMemoryService: SessionMemoryServiceLike;
  private readonly now: () => string;
  private liveSession: GoogleLiveSessionTransport | null = null;
  private readonly notifications: AssistantDeliveryPlan[] = [];
  private readonly pendingToolContinuations = new Map<string, string>();
  private readonly functionCallTaskBindings = new Map<string, string>();
  private liveSessionGeneration = 0;
  private reconnectPromise: Promise<void> | null = null;
  private sessionMemoryUpdatePromise: Promise<void> | null = null;
  private sessionMemoryDirty = true;
  private lastSentSessionMemoryContext = "";
  private lastSentTaskRuntimeContext = "";
  private sessionResumptionHandle: string | null = null;
  private sessionResumable = false;
  private closePromise: Promise<void> | null = null;
  private pendingVoiceTurnId: string | null = null;
  private readonly conversationState: HostedConversationStateSnapshot = {
    connected: false,
    connecting: false,
    status: "idle",
    muted: false,
    error: null,
    routing: {
      mode: "idle",
      summary: "No request is being reviewed yet.",
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
    this.sessionMemoryService =
      dependencies.sessionMemoryService ??
      dependencies.profileMemoryService ??
      createSessionMemoryService({
        sql: input.sql
      });
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

    await this.connectLiveSession({
      announceREADY: true
    });
  }

  private async connectLiveSession(input: {
    announceREADY: boolean;
    resumeHandle?: string;
  }): Promise<void> {
    const generation = ++this.liveSessionGeneration;
    const session = await this.liveTransport.connect({
      brainSessionId: this.input.brainSessionId,
      model: process.env.LIVE_MODEL?.trim() || undefined,
      config: {
        responseModalities: [Modality.AUDIO],
        ...(supportsExplicitVadSignal() ? { explicitVadSignal: true } : {}),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: createContextWindowCompressionConfig(),
        thinkingConfig: {
          thinkingBudget: 0
        },
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            // Increase leading capture and end-of-turn patience to reduce clipped openings on Gemini API live.
            prefixPaddingMs: 720,
            silenceDurationMs: 260
          }
        },
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Zephyr"
            }
          }
        },
        sessionResumption: createSessionResumptionConfig(input.resumeHandle),
        tools: [createDelegateToGeminiCliTool()],
        systemInstruction: createPersonaInstruction()
      },
      callbacks: {
        onopen: () => {
          if (generation !== this.liveSessionGeneration) {
            return;
          }
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
          if (generation !== this.liveSessionGeneration) {
            return;
          }
          this.conversationState.connected = false;
          this.conversationState.connecting = false;
          this.liveSession = null;

          if (!this.closePromise && this.sessionResumable && this.sessionResumptionHandle) {
            void this.resumeLiveSession().catch((error) => {
              if (generation !== this.liveSessionGeneration || this.closePromise) {
                return;
              }

              this.conversationState.connected = false;
              this.conversationState.connecting = false;
              this.conversationState.status = "idle";
              this.conversationState.error =
                info.reason ? `closed: ${info.reason}` : normalizeError(error);
              this.input.send({
                type: "conversation_state",
                state: this.getConversationState()
              });
            });
            return;
          }

          this.conversationState.status = "idle";
          this.conversationState.error = info.reason ? `closed: ${info.reason}` : null;
          this.input.send({
            type: "conversation_state",
            state: this.getConversationState()
          });
        },
        onerror: (error) => {
          if (generation !== this.liveSessionGeneration) {
            return;
          }
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
          if (generation !== this.liveSessionGeneration) {
            return;
          }
          await this.handleLiveEvent(event);
        }
      }
    });

    if (generation !== this.liveSessionGeneration) {
      session.close();
      return;
    }

    this.liveSession = session;
    await this.flushSessionMemoryContextIfNeeded(true);
    await this.sendTaskRuntimeContext(await this.buildTaskState());

    if (input.announceREADY) {
      this.input.send({
        type: "session_ready",
        brainSessionId: this.input.brainSessionId,
        conversation: this.getConversationState(),
        tasks: await this.buildTaskState()
      });
    }
  }

  async handleClientEvent(event: CloudClientEvent): Promise<void> {
    if (!this.liveSession) {
      switch (event.type) {
        case "ping":
          this.input.send({
            type: "conversation_state",
            state: this.getConversationState()
          });
          return;
        case "audio_chunk":
        case "audio_stream_end":
          // Mic shutdown and buffered audio can arrive after the live session
          // has already closed. Treat these as benign late events.
          return;
        default:
          throw new Error("Live session is not ready");
      }
    }

    switch (event.type) {
      case "typed_turn":
        await this.handleTypedTurn(event.text);
        break;
      case "audio_chunk":
        this.liveSession?.sendRealtimeAudio(event.data, event.mimeType);
        break;
      case "activity_start":
        if (supportsExplicitVadSignal()) {
          this.liveSession?.sendActivityStart();
        }
        break;
      case "activity_end":
        if (supportsExplicitVadSignal()) {
          this.liveSession?.sendActivityEnd();
        }
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

  async close(
    reason: "user_hangup" | "client_disconnect" | "startup_failed" = "client_disconnect"
  ): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      this.liveSessionGeneration += 1;
      this.liveSession?.close();
      this.liveSession = null;
      this.conversationState.connected = false;
      this.conversationState.connecting = false;
      this.conversationState.status = "closed";
      this.conversationState.error = null;
      try {
        const persistence = await this.persistencePromise;
        await persistence.brainSessionRepository.close(
          this.input.brainSessionId,
          this.now()
        );
      } finally {
        this.executor.failAll(
          reason === "user_hangup"
            ? "Session ended by user"
            : "Desktop client disconnected"
        );
        this.input.onClose?.();
      }
    })();

    return this.closePromise;
  }

  private async touchBrainSession(at = this.now()): Promise<void> {
    const persistence = await this.persistencePromise;
    await persistence.brainSessionRepository.touch(this.input.brainSessionId, at);
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
    await this.touchBrainSession(createdAt);
    this.queueSessionMemoryCapture(normalizedText, createdAt);

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
            await this.touchBrainSession();
          }
        }
        return;
      case "input_transcription_partial":
        this.applyVoiceTranscriptPartial(String(event.text ?? ""));
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
        await this.flushSessionMemoryContextIfNeeded();
        this.input.send({
          type: "conversation_state",
          state: this.getConversationState()
        });
        return;
      case "turn_complete":
        this.finalizeActiveTurn("completed");
        this.conversationState.status = "listening";
        await this.flushSessionMemoryContextIfNeeded();
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
      case "session_resumption_update":
        this.sessionResumptionHandle =
          typeof event.newHandle === "string" && event.newHandle.trim()
            ? event.newHandle
            : null;
        this.sessionResumable = event.resumable === true;
        return;
      case "go_away":
        await this.resumeLiveSession();
        return;
      default:
        return;
    }
  }

  private async resumeLiveSession(): Promise<void> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    if (!this.sessionResumable || !this.sessionResumptionHandle) {
      return;
    }

    this.reconnectPromise = (async () => {
      const previousSession = this.liveSession;
      const resumeHandle = this.sessionResumptionHandle;

      this.conversationState.connected = false;
      this.conversationState.connecting = true;
      this.conversationState.status = "connecting";
      this.conversationState.error = null;
      this.input.send({
        type: "conversation_state",
        state: this.getConversationState()
      });

      this.liveSessionGeneration += 1;
      previousSession?.close();
      this.liveSession = null;

      try {
        await this.connectLiveSession({
          announceREADY: false,
          resumeHandle: resumeHandle ?? undefined
        });
      } finally {
        this.reconnectPromise = null;
      }
    })();

    return this.reconnectPromise;
  }

  private async handleVoiceTranscriptFinal(text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const createdAt = this.now();
    const turnId = this.finalizeVoiceUserTurn(normalizedText, createdAt);
    this.conversationState.activeTurnId = turnId;
    this.pendingVoiceTurnId = null;
    this.conversationState.inputPartial = "";
    this.conversationState.lastUserTranscript = normalizedText;
    this.conversationState.outputTranscript = "";
    this.conversationState.status = "thinking";

    const persistence = await this.persistencePromise;
    await persistence.conversationRepository.save({
      brainSessionId: this.input.brainSessionId,
      speaker: "user",
      text: normalizedText,
      createdAt
    });
    await this.touchBrainSession(createdAt);
    this.queueSessionMemoryCapture(normalizedText, createdAt);

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
      const rawRequest =
        typeof args.request === "string" ? args.request.trim() : "";
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const mode = typeof args.mode === "string" ? args.mode : undefined;
      const protocolResolution = this.resolveProtocolTaskReference(
        rawRequest,
        taskId
      );

      if (protocolResolution?.kind === "unresolved_internal_call") {
        functionResponses.push({
          id: functionCall.id,
          name: "delegate_to_gemini_cli",
          response: {
            error: protocolResolution.message
          },
          scheduling: FunctionResponseScheduling.SILENT,
          willContinue: false
        });
        continue;
      }

      const request = protocolResolution?.request ?? rawRequest;
      const resolvedTaskId = protocolResolution?.taskId ?? taskId;
      const resolvedMode = protocolResolution?.mode ?? mode;
      const result = await loop.handleDelegateToGeminiCli({
        brainSessionId: this.input.brainSessionId,
        request,
        taskId: resolvedTaskId,
        mode: resolvedMode as
          | "auto"
          | "new_task"
          | "resume"
          | "status"
          | undefined,
        now: this.now()
      });

      if (result.taskId) {
        this.functionCallTaskBindings.set(functionCall.id, result.taskId);
      }

      functionResponses.push({
        id: functionCall.id,
        name: "delegate_to_gemini_cli",
        response: {
          output: result
        },
        scheduling: this.resolveResponseScheduling(result),
        willContinue: this.shouldContinueFunctionCall(result)
      });

      if (this.shouldContinueFunctionCall(result) && result.taskId) {
        this.pendingToolContinuations.set(result.taskId, functionCall.id);
      } else if (result.taskId) {
        this.pendingToolContinuations.delete(result.taskId);
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
      request: "status update",
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
          },
          scheduling: this.resolveResponseScheduling(result),
          willContinue: false
        }
      ]
    });

  }

  private shouldContinueFunctionCall(result: {
    accepted: boolean;
    taskId?: string;
    status: string;
  }): boolean {
    return (
      result.accepted === true &&
      typeof result.taskId === "string" &&
      (result.status === "running" ||
        result.status === "waiting_input" ||
        result.status === "approval_required")
    );
  }

  private resolveResponseScheduling(result: {
    status: string;
    presentation?: {
      ownership: "live" | "runtime";
      allowLiveModelOutput: boolean;
    };
  }): FunctionResponseScheduling {
    if (!result.presentation?.allowLiveModelOutput) {
      return FunctionResponseScheduling.SILENT;
    }

    if (
      result.status === "failed" ||
      result.status === "waiting_input" ||
      result.status === "approval_required"
    ) {
      return FunctionResponseScheduling.INTERRUPT;
    }

    if (result.status === "completed") {
      return FunctionResponseScheduling.WHEN_IDLE;
    }

    return FunctionResponseScheduling.WHEN_IDLE;
  }

  private resolveProtocolTaskReference(
    request: string,
    taskId?: string
  ):
    | {
        kind: "resolved_internal_call";
        request: string;
        taskId: string;
        mode: "status";
      }
    | {
        kind: "unresolved_internal_call";
        message: string;
      }
    | null {
    const directTaskId =
      typeof taskId === "string" && this.functionCallTaskBindings.has(taskId)
        ? this.functionCallTaskBindings.get(taskId)
        : null;
    if (directTaskId) {
      return {
        kind: "resolved_internal_call",
        request: "status update",
        taskId: directTaskId,
        mode: "status"
      };
    }

    const requestMatch = request.match(/\b(function-call-[A-Za-z0-9_-]+)\b/i);
    if (!requestMatch) {
      return null;
    }

    const mappedTaskId = this.functionCallTaskBindings.get(requestMatch[1]);
    if (!mappedTaskId) {
      return {
        kind: "unresolved_internal_call",
        message: `Unknown internal function call reference: ${requestMatch[1]}`
      };
    }

    return {
      kind: "resolved_internal_call",
      request: "status update",
      taskId: mappedTaskId,
      mode: "status"
    };
  }

  private createUserTurn(
    inputMode: "typed" | "voice",
    text: string,
    createdAt: string,
    options: {
      turnId?: string;
      partial?: boolean;
      streaming?: boolean;
    } = {}
  ): string {
    const turnId = options.turnId ?? `turn-${++this.turnSequence}`;
    const userMessageId = `${turnId}:user`;
    this.upsertTurn({
      turnId,
      inputMode,
      stage: options.partial ? "capturing" : "thinking",
      userMessageId,
      startedAt: createdAt,
      updatedAt: createdAt
    });
    this.upsertTimelineItem({
      id: userMessageId,
      turnId,
      kind: "user_message",
      inputMode,
      speaker: "user",
      text,
      partial: options.partial === true,
      streaming: options.streaming === true,
      interrupted: false,
      responseSource: "live",
      createdAt,
      updatedAt: createdAt
    });
    return turnId;
  }

  private applyAssistantTranscript(text: string, finished: boolean): void {
    const activeTurnId =
      this.conversationState.activeTurnId ??
      this.pendingVoiceTurnId ??
      `turn-${++this.turnSequence}`;
    if (!this.conversationState.activeTurnId) {
      const existingTurn = this.conversationState.conversationTurns.find(
        (turn: ConversationTurnViewModel) => turn.turnId === activeTurnId
      );
      this.upsertTurn({
        turnId: activeTurnId,
        inputMode: existingTurn?.inputMode ?? "voice",
        stage: "responding",
        startedAt: existingTurn?.startedAt ?? this.now(),
        updatedAt: this.now()
      });
      this.conversationState.activeTurnId = activeTurnId;
      this.pendingVoiceTurnId = null;
    }

    const assistantMessageId = `${activeTurnId}:assistant`;
    const createdAt = this.now();
    const existing = this.conversationState.conversationTimeline.find(
      (item: ConversationTimelineItem) => item.id === assistantMessageId
    );
    const mergedText = finished
      ? text.trim()
      : mergeStreamingTranscript(existing?.text ?? "", text);
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

  private applyVoiceTranscriptPartial(text: string): void {
    const normalizedText = text.trim();
    this.conversationState.inputPartial = normalizedText;
    if (!normalizedText) {
      return;
    }

    const createdAt = this.now();
    const turnId =
      this.pendingVoiceTurnId ??
      this.createUserTurn("voice", normalizedText, createdAt, {
        partial: true,
        streaming: true
      });

    if (!this.pendingVoiceTurnId) {
      this.pendingVoiceTurnId = turnId;
    }

    this.upsertTimelineItem({
      id: `${turnId}:user`,
      turnId,
      kind: "user_message",
      inputMode: "voice",
      speaker: "user",
      text: normalizedText,
      partial: true,
      streaming: true,
      interrupted: false,
      responseSource: "live",
      createdAt:
        this.conversationState.conversationTimeline.find(
          (item: ConversationTimelineItem) => item.id === `${turnId}:user`
        )?.createdAt ?? createdAt,
      updatedAt: createdAt
    });

    this.upsertTurn({
      turnId,
      inputMode: "voice",
      stage: "capturing",
      userMessageId: `${turnId}:user`,
      updatedAt: createdAt
    });
  }

  private finalizeVoiceUserTurn(text: string, createdAt: string): string {
    const existingTurnId = this.pendingVoiceTurnId;
    if (!existingTurnId) {
      return this.createUserTurn("voice", text, createdAt);
    }

    this.upsertTimelineItem({
      id: `${existingTurnId}:user`,
      turnId: existingTurnId,
      kind: "user_message",
      inputMode: "voice",
      speaker: "user",
      text,
      partial: false,
      streaming: false,
      interrupted: false,
      responseSource: "live",
      createdAt:
        this.conversationState.conversationTimeline.find(
          (item: ConversationTimelineItem) => item.id === `${existingTurnId}:user`
        )?.createdAt ?? createdAt,
      updatedAt: createdAt
    });

    this.upsertTurn({
      turnId: existingTurnId,
      inputMode: "voice",
      stage: "thinking",
      userMessageId: `${existingTurnId}:user`,
      updatedAt: createdAt
    });

    return existingTurnId;
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

  private findTaskRequestSummary(taskId: string): string | undefined {
    const taskTurn = this.conversationState.conversationTurns.find(
      (turn) => turn.taskId === taskId && turn.userMessageId
    );
    if (!taskTurn?.userMessageId) {
      return undefined;
    }

    return this.conversationState.conversationTimeline.find(
      (item) => item.id === taskTurn.userMessageId
    )?.text;
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
    const timelineTasks = [...activeTasks, ...recentTasks].filter(
      (task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index
    );
    const taskTimelines = await Promise.all(
      timelineTasks.map(async (task) => ({
        taskId: task.id,
        events: await persistence.taskEventRepository.listByTaskId(task.id)
      }))
    );
    const taskExecutionArtifacts = await Promise.all(
      timelineTasks.map(async (task) => ({
        taskId: task.id,
        artifacts: await persistence.taskExecutionArtifactRepository.listByTaskId(task.id)
      }))
    );
    const intake = await (await this.loopPromise).getActiveTaskIntake(
      this.input.brainSessionId
    );

    const latestEventByTaskId = new Map(
      taskTimelines.map((timeline) => [timeline.taskId, timeline.events.at(-1)])
    );
    const latestNotificationByTaskId = new Map(
      [...this.notifications]
        .filter((plan) => typeof plan.taskId === "string")
        .map((plan) => [plan.taskId!, plan] as const)
    );
    const taskRunners = activeTasks.map((task) =>
      buildTaskRunner(task, latestEventByTaskId.get(task.id))
    );
    const taskRunnerDetails = timelineTasks.map((task) => {
      const events =
        taskTimelines.find((timeline) => timeline.taskId === task.id)?.events ?? [];
      const executionTrace =
        taskExecutionArtifacts.find((artifact) => artifact.taskId === task.id)?.artifacts ?? [];
      return buildTaskRunnerDetail(
        task,
        events,
        executionTrace,
        latestNotificationByTaskId.get(task.id),
        this.findTaskRequestSummary(task.id)
      );
    });
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
      taskRunnerDetails,
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
    await this.sendTaskRuntimeContext(taskState);
    this.input.send({
      type: "task_state",
      state: taskState
    });
  }

  private queueSessionMemoryCapture(text: string, now: string): void {
    const run = async (): Promise<void> => {
      try {
        const result = await this.sessionMemoryService.rememberFromUtterance({
          brainSessionId: this.input.brainSessionId,
          text,
          now
        });

        if (result.updated) {
          this.sessionMemoryDirty = true;
        }
      } catch (error) {
        console.error(
          `[cloud-agent-session] session memory extraction failed ${normalizeError(error)}`
        );
      }
    };

    const pending = this.sessionMemoryUpdatePromise
      ? this.sessionMemoryUpdatePromise.then(run, run)
      : run();

    this.sessionMemoryUpdatePromise = pending.finally(() => {
      if (this.sessionMemoryUpdatePromise === pending) {
        this.sessionMemoryUpdatePromise = null;
      }
    });
  }

  private async flushSessionMemoryContextIfNeeded(force = false): Promise<void> {
    if (!this.liveSession) {
      return;
    }

    if (this.sessionMemoryUpdatePromise) {
      await this.sessionMemoryUpdatePromise;
    }

    if (!force && !this.sessionMemoryDirty) {
      return;
    }

    const context = await this.sessionMemoryService.buildRuntimeContext(
      this.input.brainSessionId
    );

    this.sessionMemoryDirty = false;
    if (!context.trim()) {
      this.lastSentSessionMemoryContext = "";
      return;
    }

    if (!force && context === this.lastSentSessionMemoryContext) {
      return;
    }

    this.lastSentSessionMemoryContext = context;
    this.liveSession.sendContext(context);
  }

  private async sendTaskRuntimeContext(
    taskState?: HostedTaskStateSnapshot
  ): Promise<void> {
    if (!this.liveSession) {
      return;
    }

    const resolvedTaskState = taskState ? await Promise.resolve(taskState) : await this.buildTaskState();
    const runtimeSummary = summarizeRuntimeContext(resolvedTaskState).trim();
    if (!runtimeSummary) {
      this.lastSentTaskRuntimeContext = "";
      return;
    }

    if (runtimeSummary === this.lastSentTaskRuntimeContext) {
      return;
    }

    this.lastSentTaskRuntimeContext = runtimeSummary;
    this.liveSession.sendContext(runtimeSummary);
  }
}
