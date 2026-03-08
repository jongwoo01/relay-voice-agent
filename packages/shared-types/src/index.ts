export type IntentType = "small_talk" | "question" | "task_request" | "unclear";

export type TaskStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskEventType =
  | "task_created"
  | "task_queued"
  | "task_started"
  | "executor_progress"
  | "executor_completed"
  | "executor_failed";

export type NextAction =
  | { type: "reply" }
  | { type: "clarify" }
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
}

export interface FinalizedUtterance {
  text: string;
  intent: IntentType;
  createdAt: string;
}

export interface TaskEvent {
  taskId: string;
  type: TaskEventType;
  message: string;
  createdAt: string;
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
}
