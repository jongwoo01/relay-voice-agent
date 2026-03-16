import type { PromptSpec } from "./prompt-spec.js";

export interface TaskRoutingPromptInput {
  utteranceIntent: string;
  utteranceText: string;
  delegateMode?: "auto" | "new_task" | "resume" | "status";
  explicitTaskId?: string | null;
  activeTasksJson: string;
  recentCompletedTasksJson: string;
  otherRecentTasksJson: string;
}

export const TASK_ROUTING_PROMPT_ID = "relay.task_routing.resolve";

/**
 * Task routing prompt.
 * Pipeline: RealtimeGatewayService -> BrainTurnService -> TaskRoutingResolver -> Vertex AI models.generateContent.
 * Input: utterance summary plus serialized active/recent task context.
 * Output: JSON-only routing decision including optional executorPrompt.
 */
export const TASK_ROUTING_PROMPT: PromptSpec<TaskRoutingPromptInput> = {
  metadata: {
    id: TASK_ROUTING_PROMPT_ID,
    purpose:
      "Choose whether the latest task_request should reply, clarify, check status, continue, or create a task.",
    usedBy: "GeminiTaskRoutingResolver.resolve",
    pipeline: "brain turn routing before task execution",
    inputContract:
      "Requires utterance intent/text and serialized active/recent task context buckets.",
    outputContract:
      "JSON only with kind, targetTaskId, clarificationNeeded, clarificationText, executorPrompt, and reason."
  },
  build({
    utteranceIntent,
    utteranceText,
    delegateMode,
    explicitTaskId,
    activeTasksJson,
    recentCompletedTasksJson,
    otherRecentTasksJson
  }) {
    return [
      "Route the user's latest local desktop task utterance.",
      "Return JSON only.",
      "You must decide exactly one kind:",
      "- reply: only for conversational non-task replies.",
      "- clarify: the task or action is ambiguous and needs a question.",
      "- status: the user wants a status/result update without new execution.",
      "- set_completion_notification: the user wants to be notified when an active task finishes.",
      "- continue_task: continue an existing task that is not blocked.",
      "- continue_blocked_task: the user is answering a blocked task or giving more input to continue it.",
      "- create_task: start a brand new task.",
      "Prefer create_task when the user references the result of a recently completed task and asks for a new action.",
      "Treat completed tasks as references to past results by default, not as the default target to continue.",
      "If the user refers to a recently created folder/file/list/summary and asks to do something new with it, prefer create_task.",
      "Choose status only for explicit progress/result/completion questions.",
      "Choose set_completion_notification only when the user is clearly asking to be told when an active task completes.",
      "Choose continue_task or continue_blocked_task only when the user clearly wants the same task to keep going.",
      "Use only the provided task ids. If no task should be targeted, return null.",
      "If there are multiple plausible target tasks, choose clarify.",
      "If explicitTaskId is provided, either target that exact id or choose clarify.",
      "If delegateMode is status, prefer status or clarify.",
      "If delegateMode is resume, prefer continue_task or continue_blocked_task or clarify.",
      "If delegateMode is new_task, prefer create_task.",
      "For continue_task, continue_blocked_task, and create_task, executorPrompt must contain the exact prompt to send to the executor.",
      "For reply, clarify, status, and set_completion_notification, executorPrompt must be null.",
      "Preserve the user's wording in executorPrompt. Only add the minimum necessary context if the user is clearly answering a blocked task.",
      "For clarify, set clarificationNeeded=true and provide a short English clarificationText.",
      "For non-clarify decisions, set clarificationNeeded=false and clarificationText=null.",
      'Example: "Create a txt file with today\'s LLM news in the LLM folder you created earlier" -> create_task.',
      'Example: "How far along is that folder task?" -> status.',
      'Example: "Tell me when it finishes" -> set_completion_notification.',
      'Example: "Continue that task" -> continue_task.',
      `Utterance intent: ${utteranceIntent}`,
      `Latest utterance: ${utteranceText}`,
      `delegateMode: ${delegateMode ?? "auto"}`,
      `explicitTaskId: ${explicitTaskId ?? "null"}`,
      `Active tasks: ${activeTasksJson}`,
      `Recent completed tasks: ${recentCompletedTasksJson}`,
      `Other recent tasks: ${otherRecentTasksJson}`
    ].join("\n");
  }
};

export function buildTaskRoutingPrompt(
  input: TaskRoutingPromptInput
): string {
  return TASK_ROUTING_PROMPT.build(input);
}
