import type { TaskIntakeSession } from "@agent/shared-types";
import type { PromptSpec } from "./prompt-spec.js";

export interface TaskIntakeStartPromptInput {
  text: string;
}

export interface TaskIntakeUpdatePromptInput {
  session: TaskIntakeSession;
  text: string;
}

export const TASK_INTAKE_START_PROMPT_ID = "relay.task_intake.start";
export const TASK_INTAKE_UPDATE_PROMPT_ID = "relay.task_intake.update";

/**
 * Task intake start prompt.
 * Pipeline: TextRealtimeSessionLoop -> TaskIntakeService -> Vertex AI models.generateContent.
 * Input: initial task request text.
 * Output: JSON-only requiredSlots + filledSlots analysis.
 */
export const TASK_INTAKE_START_PROMPT: PromptSpec<TaskIntakeStartPromptInput> = {
  metadata: {
    id: TASK_INTAKE_START_PROMPT_ID,
    purpose:
      "Detect whether a new task request is executable immediately or needs more intake slots.",
    usedBy: "GeminiTaskIntakeResolver.analyzeStart",
    pipeline: "task intake session creation",
    inputContract: "Requires the raw user request text.",
    outputContract:
      'JSON only with requiredSlots and filledSlots for slots target|time|scope|location|risk_ack.'
  },
  build({ text }) {
    return [
      "Analyze a user request for task intake.",
      "Return JSON only.",
      "Determine only execution-critical required slots for this request.",
      "Do not ask for optional details.",
      "Allowed slots: target, time, scope, location, risk_ack.",
      "If the request can be executed immediately, return an empty requiredSlots array.",
      'Treat file inspection requests like "check my desktop and tell me the names and counts of folders and files" as immediately executable.',
      "Do not require scope when the user already specified the output format, such as names, counts, contents, or a simple listing.",
      "Fill only slots explicitly present in the user's text.",
      `User request: ${text}`
    ].join("\n");
  }
};

/**
 * Task intake update prompt.
 * Pipeline: TextRealtimeSessionLoop -> TaskIntakeService -> Vertex AI models.generateContent.
 * Input: current intake session snapshot plus the latest user message.
 * Output: JSON-only resolution + requiredSlots + filledSlots analysis.
 */
export const TASK_INTAKE_UPDATE_PROMPT: PromptSpec<TaskIntakeUpdatePromptInput> = {
  metadata: {
    id: TASK_INTAKE_UPDATE_PROMPT_ID,
    purpose:
      "Decide whether the latest user message answers the current intake or replaces it with a new task.",
    usedBy: "GeminiTaskIntakeResolver.analyzeUpdate",
    pipeline: "task intake session update",
    inputContract:
      "Requires the active TaskIntakeSession plus the latest user message text.",
    outputContract:
      'JSON only with resolution, requiredSlots, and filledSlots for slots target|time|scope|location|risk_ack.'
  },
  build({ session, text }) {
    return [
      "Analyze a user's latest message while a task intake session is active.",
      "Return JSON only.",
      "Choose resolution:",
      '- "answer_current_intake" if the message answers the current missing task details, even partially.',
      '- "replace_task" if the message is a new standalone task request that should replace the current intake.',
      "Allowed slots: target, time, scope, location, risk_ack.",
      "Fill only the slots explicitly present in the latest user message.",
      `Active intake source text: ${session.sourceText}`,
      `Active intake working text: ${session.workingText}`,
      `Currently missing slots: ${session.missingSlots.join(", ") || "none"}`,
      `Latest user message: ${text}`
    ].join("\n");
  }
};

export function buildTaskIntakeStartPrompt(
  input: TaskIntakeStartPromptInput
): string {
  return TASK_INTAKE_START_PROMPT.build(input);
}

export function buildTaskIntakeUpdatePrompt(
  input: TaskIntakeUpdatePromptInput
): string {
  return TASK_INTAKE_UPDATE_PROMPT.build(input);
}
