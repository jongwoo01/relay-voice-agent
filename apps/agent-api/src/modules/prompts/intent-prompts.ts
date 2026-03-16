import type { PromptSpec } from "./prompt-spec.js";

export interface IntentResolutionPromptInput {
  text: string;
}

export const INTENT_RESOLUTION_PROMPT_ID = "relay.intent.resolve_final_utterance";

/**
 * Intent classification prompt for finalized user utterances.
 * Pipeline: LiveTranscriptAdapter -> IntentResolver -> Vertex AI models.generateContent.
 * Input: finalized user utterance text.
 * Output: JSON string with intent and assistantReplyText.
 */
export const INTENT_RESOLUTION_PROMPT: PromptSpec<IntentResolutionPromptInput> = {
  metadata: {
    id: INTENT_RESOLUTION_PROMPT_ID,
    purpose:
      "Classify the user's final utterance into a routing intent and optional direct reply.",
    usedBy: "GeminiIntentResolver.resolve",
    pipeline: "live transcript finalization and text turn intake",
    inputContract: "Requires the finalized utterance text.",
    outputContract:
      'JSON only: {"intent":"small_talk|question|task_request|unclear","assistantReplyText":"string"}.'
  },
  build({ text }) {
    return [
      "Classify the user's final utterance into exactly one intent.",
      'Return JSON only in the form {"intent":"...","assistantReplyText":"..."}.',
      "Allowed intents: small_talk, question, task_request, unclear.",
      "Use task_request for actionable requests that should trigger work.",
      "Use task_request when answering requires inspecting local files, directories, apps, browser state, or running local tools or commands.",
      "Requests like 'tell me the files on my desktop', 'show me folder names', 'count files', 'find X on this machine', or 'open Y' are task_request, not question.",
      "Questions like 'what is on my desktop?', 'how many files are in downloads?', or 'can you see that folder?' are task_request if they refer to local machine state.",
      "Use question only when the answer can be produced directly without inspecting the local machine or performing work.",
      "Use small_talk for greetings, chit-chat, or acknowledgements.",
      "Use unclear when the request is too ambiguous to act on.",
      "If intent is task_request, set assistantReplyText to an empty string.",
      "If intent is small_talk or question, assistantReplyText must be a concise English reply in one or two short sentences.",
      "If intent is unclear, assistantReplyText must be a concise English clarification question.",
      "Do not mention internal routing, models, policies, or hidden reasoning.",
      `Utterance: ${text}`
    ].join("\n");
  }
};

export function buildIntentResolutionPrompt(
  input: IntentResolutionPromptInput
): string {
  return INTENT_RESOLUTION_PROMPT.build(input);
}
