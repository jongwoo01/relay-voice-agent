import type {
  AssistantDeliveryPlan,
  ConversationTimelineItem,
  ConversationTurnViewModel,
  MainAvatarState,
  Task,
  TaskCompletionReport,
  TaskEvent,
  TaskIntakeSlot,
  TaskRunnerViewModel
} from "@agent/shared-types";

export interface HostedTaskStateSnapshot {
  tasks: Task[];
  recentTasks: Task[];
  taskTimelines: Array<{
    taskId: string;
    events: TaskEvent[];
  }>;
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
  | { type: "auth"; token: string }
  | { type: "end_session"; reason?: "user_hangup" | "client_disconnect" }
  | { type: "audio_chunk"; data: string; mimeType?: string }
  | { type: "audio_stream_end" }
  | { type: "typed_turn"; text: string }
  | { type: "executor_progress"; runId: string; taskId: string; event: TaskEvent }
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
  | { type: "ping" };

export type CloudServerEvent =
  | {
      type: "session_ready";
      brainSessionId: string;
      conversation: HostedConversationStateSnapshot;
      tasks: HostedTaskStateSnapshot;
    }
  | { type: "live_output_audio_chunk"; data: string; mimeType: string }
  | { type: "live_output_transcript"; text: string; finished: boolean }
  | { type: "conversation_state"; state: HostedConversationStateSnapshot }
  | { type: "task_state"; state: HostedTaskStateSnapshot }
  | { type: "executor_request"; request: HostedExecutorRequest }
  | { type: "error"; message: string; code?: string };
