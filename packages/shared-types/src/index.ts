export type IntentType = "small_talk" | "question" | "task_request" | "unclear";

export type TaskStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_input"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskEventType =
  | "task_created"
  | "task_queued"
  | "task_started"
  | "executor_progress"
  | "executor_waiting_input"
  | "executor_approval_required"
  | "executor_completed"
  | "executor_failed";

export type TaskIntakeSlot =
  | "target"
  | "time"
  | "scope"
  | "location"
  | "risk_ack";

export type TaskIntakeStatus = "collecting" | "ready" | "cancelled";

export interface TaskIntakeSession {
  brainSessionId: string;
  status: TaskIntakeStatus;
  sourceText: string;
  workingText: string;
  requiredSlots: TaskIntakeSlot[];
  filledSlots: Partial<Record<TaskIntakeSlot, string>>;
  missingSlots: TaskIntakeSlot[];
  lastQuestion?: string;
  createdAt: string;
  updatedAt: string;
}

export type NextAction =
  | { type: "reply" }
  | { type: "clarify" }
  | {
      type: "error";
      reason:
        | "auth_failed"
        | "quota_exhausted"
        | "config_invalid"
        | "upstream_error";
    }
  | { type: "task_intake_clarify"; missingSlots: TaskIntakeSlot[] }
  | { type: "status"; taskId: string }
  | { type: "create_task" }
  | { type: "resume_task"; taskId: string }
  | { type: "set_completion_notification"; taskId: string };

export interface Task {
  id: string;
  title: string;
  normalizedGoal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completionReport?: TaskCompletionReport;
}

export interface TaskCompletionReport {
  summary: string;
  detailedAnswer?: string;
  keyFindings?: string[];
  verification: "verified" | "uncertain";
  changes: string[];
  question?: string;
}

export type TaskExecutionArtifactKind =
  | "init"
  | "message"
  | "tool_use"
  | "tool_result"
  | "error"
  | "result";

export interface TaskExecutionArtifact {
  taskId: string;
  seq: number;
  kind: TaskExecutionArtifactKind;
  createdAt: string;
  title: string;
  body?: string;
  detail?: string;
  toolName?: string;
  status?: string;
  role?: string;
  payloadJson?: Record<string, unknown>;
}

export interface FinalizedUtterance {
  text: string;
  intent: IntentType;
  assistantReplyText?: string;
  createdAt: string;
}

export interface TaskEvent {
  taskId: string;
  type: TaskEventType;
  message: string;
  createdAt: string;
}

export interface TaskRoutingTaskContext {
  task: Task;
  isActive: boolean;
  isRecentCompleted: boolean;
  latestEventPreview?: string;
}

export interface TaskTransitionResult {
  task: Task;
  event: TaskEvent;
}

export interface TaskExecutorSession {
  taskId: string;
  sessionId?: string;
  workingDirectory?: string;
  updatedAt: string;
}

export interface BrainTurnInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  activeTasks: Task[];
  recentTasks?: Task[];
  taskContexts?: TaskRoutingTaskContext[];
  now: string;
}

export interface AssistantEnvelope {
  text: string;
  tone: "reply" | "clarify" | "task_ack";
}

export type AssistantPriority = "normal" | "high" | "critical";

export type AssistantDeliveryPolicy =
  | "immediate"
  | "interrupt_if_speaking"
  | "next_turn"
  | "ui_only";

export type AssistantNotificationReason =
  | "task_completed"
  | "task_failed"
  | "task_waiting_input"
  | "approval_required";

export interface ConversationMessage {
  brainSessionId: string;
  speaker: "user" | "assistant";
  text: string;
  createdAt: string;
  tone?: AssistantEnvelope["tone"];
  taskId?: string;
}

export interface AssistantNotification {
  message: ConversationMessage;
  priority: AssistantPriority;
  delivery: AssistantDeliveryPolicy;
  reason: AssistantNotificationReason;
}

export interface InteractionActivityState {
  userSpeaking: boolean;
  assistantSpeaking: boolean;
}

export interface AssistantDeliveryPlan {
  uiText: string;
  speechText?: string;
  delivery: AssistantDeliveryPolicy;
  reason?: AssistantNotificationReason;
  taskId?: string;
  createdAt?: string;
}

export type MemoryItemType =
  | "profile"
  | "preferences"
  | "routines"
  | "current_context"
  | "task_history";

export type MainAvatarState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "briefing"
  | "waiting_user"
  | "reflecting";

export interface TaskRunnerViewModel {
  taskId: string;
  label: string;
  title: string;
  status: TaskStatus;
  headline: string;
  statusLabel: string;
  latestHumanUpdate: string;
  needsUserAction?: string;
  progressSummary?: string;
  blockingReason?: string;
  lastUpdatedAt?: string;
}

export type SubAvatarViewModel = TaskRunnerViewModel;

export type TaskRunnerTimelineEntryKind =
  | "request_received"
  | "runner_preparing"
  | "execution_dispatched"
  | "progress_update"
  | "needs_input"
  | "needs_approval"
  | "completion_received"
  | "final_summary"
  | "failure";

export type TaskRunnerTimelineEntrySource = "task" | "executor" | "system";

export type TaskRunnerTimelineEntryEmphasis =
  | "normal"
  | "info"
  | "warning"
  | "success"
  | "error";

export interface TaskRunnerTimelineEntry {
  kind: TaskRunnerTimelineEntryKind;
  title: string;
  body: string;
  createdAt: string;
  emphasis: TaskRunnerTimelineEntryEmphasis;
  source: TaskRunnerTimelineEntrySource;
}

export interface TaskRunnerAdvancedTraceEntry {
  kind: string;
  summary: string;
  createdAt: string;
  source: string;
  detail?: string;
}

export interface TaskRunnerDetailViewModel {
  taskId: string;
  title: string;
  status: TaskStatus;
  headline: string;
  statusLabel: string;
  heroSummary: string;
  latestHumanUpdate: string;
  needsUserAction?: string;
  requestSummary?: string;
  lastUpdatedAt?: string;
  timeline: TaskRunnerTimelineEntry[];
  resultSummary?: string;
  detailedAnswer?: string;
  keyFindings?: string[];
  verification?: TaskCompletionReport["verification"];
  changes: string[];
  question?: string;
  executionTrace?: TaskExecutionArtifact[];
  advancedTrace: TaskRunnerAdvancedTraceEntry[];
}

export type ConversationInputMode = "typed" | "voice";

export type ConversationTurnStage =
  | "capturing"
  | "thinking"
  | "responding"
  | "delegated"
  | "waiting_input"
  | "completed"
  | "failed";

export type ConversationTimelineItemKind =
  | "user_message"
  | "assistant_message"
  | "task_event";

export type ConversationResponseSource = "live" | "runtime" | "delegate";

export interface ConversationTimelineItem {
  id: string;
  turnId: string;
  kind: ConversationTimelineItemKind;
  inputMode: ConversationInputMode;
  speaker: "user" | "assistant" | "system";
  text: string;
  partial: boolean;
  streaming: boolean;
  interrupted: boolean;
  tone?: AssistantEnvelope["tone"];
  taskId?: string;
  taskStatus?: TaskStatus;
  responseSource?: ConversationResponseSource;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurnViewModel {
  turnId: string;
  inputMode: ConversationInputMode;
  stage: ConversationTurnStage;
  userMessageId?: string;
  assistantMessageId?: string;
  taskId?: string;
  startedAt?: string;
  updatedAt?: string;
}

export type DebugEventSource =
  | "transport"
  | "live"
  | "bridge"
  | "runtime"
  | "executor";

export interface DebugEventViewModel {
  id: string;
  source: DebugEventSource;
  kind: string;
  summary: string;
  detail?: string;
  turnId?: string;
  taskId?: string;
  createdAt: string;
}

export interface HostedTaskStateSnapshot {
  tasks: Task[];
  recentTasks: Task[];
  taskTimelines: Array<{
    taskId: string;
    events: TaskEvent[];
  }>;
  taskRunnerDetails: TaskRunnerDetailViewModel[];
  intake: {
    active: boolean;
    missingSlots: TaskIntakeSlot[];
    lastQuestion: string | null;
    workingText: string;
  };
  notifications: {
    delivered: AssistantDeliveryPlan[];
    pending: AssistantDeliveryPlan[];
  };
  pendingBriefingCount: number;
  avatar: {
    mainState: MainAvatarState;
    taskRunners: TaskRunnerViewModel[];
  };
}

export interface HostedConversationStateSnapshot {
  connected: boolean;
  connecting: boolean;
  status: string;
  muted: boolean;
  error: string | null;
  routing: {
    mode: string;
    summary: string;
    detail: string;
  };
  conversationTimeline: ConversationTimelineItem[];
  conversationTurns: ConversationTurnViewModel[];
  activeTurnId: string | null;
  inputPartial: string;
  lastUserTranscript: string;
  outputTranscript: string;
}

export interface HostedExecutorRequest {
  runId: string;
  taskId: string;
  request: {
    task: Task;
    now: string;
    prompt: string;
    workingDirectory?: string;
    resumeSessionId?: string;
  };
}

export type CloudClientEvent =
  | {
      type: "auth";
      token: string;
    }
  | {
      type: "audio_chunk";
      data: string;
      mimeType?: string;
    }
  | {
      type: "audio_stream_end";
    }
  | {
      type: "typed_turn";
      text: string;
    }
  | {
      type: "executor_progress";
      runId: string;
      taskId: string;
      event: TaskEvent;
    }
  | {
      type: "executor_terminal";
      runId: string;
      taskId: string;
      ok: boolean;
      result?: {
        progressEvents: TaskEvent[];
        completionEvent: TaskEvent;
        outcome?: "completed" | "waiting_input" | "approval_required";
        sessionId?: string;
        report?: TaskCompletionReport;
      };
      error?: string;
    }
  | {
      type: "ping";
    };

export type CloudServerEvent =
  | {
      type: "session_ready";
      brainSessionId: string;
      conversation: HostedConversationStateSnapshot;
      tasks: HostedTaskStateSnapshot;
    }
  | {
      type: "live_output_audio_chunk";
      data: string;
      mimeType: string;
    }
  | {
      type: "live_output_transcript";
      text: string;
      finished: boolean;
    }
  | {
      type: "conversation_state";
      state: HostedConversationStateSnapshot;
    }
  | {
      type: "task_state";
      state: HostedTaskStateSnapshot;
    }
  | {
      type: "executor_request";
      request: HostedExecutorRequest;
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };
