import type { PromptSpec } from "./prompt-spec.js";

export interface SessionMemoryExtractionPromptInput {
  existingItemsJson: string;
  text: string;
}

export const SESSION_MEMORY_EXTRACTION_PROMPT_ID =
  "relay.session_memory.extract";

/**
 * Session memory extraction prompt.
 * Pipeline: CloudAgentSession/Text turns -> SessionMemoryService -> Vertex AI models.generateContent.
 * Input: existing session memory summary plus the latest utterance.
 * Output: JSON-only storeItems array for session-scoped memory.
 */
export const SESSION_MEMORY_EXTRACTION_PROMPT: PromptSpec<SessionMemoryExtractionPromptInput> =
  {
    metadata: {
      id: SESSION_MEMORY_EXTRACTION_PROMPT_ID,
      purpose:
        "Extract only reusable, session-scoped facts that can improve later turns.",
      usedBy: "GeminiSessionMemoryExtractor.extract",
      pipeline: "safe-turn session memory capture",
      inputContract:
        "Requires serialized existing memory items plus the latest user utterance.",
      outputContract:
        'JSON only: {"storeItems":[{"kind","key","summary","valueText","importance","confidence"}]}.'
    },
    build({ existingItemsJson, text }) {
      return [
        "You decide what session memory to save for Relay, an English-speaking voice agent for the Google ecosystem.",
        "Return JSON only.",
        "This memory is session-scoped only. Never assume it should persist beyond the current brainSessionId.",
        "Store only information that is likely to improve later turns in the same session.",
        "Good candidates: preferred name, response style, workflow preferences, safety constraints, stable background facts relevant to the ongoing session, or current project context that will matter again soon.",
        "Ignore casual chatter, one-off requests already captured elsewhere, speculative statements, emotional venting with no future utility, and facts not explicitly stated by the user.",
        "If the latest utterance updates an existing memory, reuse the same key so it replaces the older value.",
        "Use short stable keys such as preferred_name, response_style, destructive_confirmation, project_context, timezone, or pronouns.",
        "Write summary as a concise English note that can be shown directly to the live model.",
        "Keep summaries factual. Do not include instructions that were not explicitly stated.",
        "Return at most 3 items.",
        `Existing session memory: ${existingItemsJson}`,
        `Latest user utterance: ${text}`,
        'Return schema: {"storeItems":[{"kind":"identity|preference|workflow|constraint|background|current_context","key":"string","summary":"string","valueText":"string","importance":"high|medium|low","confidence":0.0}]}'
      ].join("\n");
    }
  };

export function buildSessionMemoryExtractionPrompt(
  input: SessionMemoryExtractionPromptInput
): string {
  return SESSION_MEMORY_EXTRACTION_PROMPT.build(input);
}
