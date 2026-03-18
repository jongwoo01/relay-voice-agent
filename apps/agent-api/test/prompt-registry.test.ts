import { describe, expect, it } from "vitest";
import {
  buildIntentResolutionPrompt,
  buildRelayPersonaInstruction,
  buildSessionMemoryExtractionPrompt,
  buildTaskIntakeStartPrompt,
  buildTaskIntakeUpdatePrompt,
  buildTaskRoutingPrompt
} from "../src/index.js";

describe("runtime prompt registry", () => {
  it("builds the live persona instruction with grounding rules", () => {
    const prompt = buildRelayPersonaInstruction();

    expect(prompt).toContain("You are Relay, the voice agent for the Google ecosystem.");
    expect(prompt).toContain(
      "Refer to yourself as Relay when the user asks who you are or what you are called."
    );
    expect(prompt).toContain(
      "If the user asks about local files, file contents, browser state, desktop state, or the result of prior local work, call delegate_to_gemini_cli instead of answering from memory alone."
    );
    expect(prompt).toContain(
      "Do not invent local files, browser tabs, app state, policy restrictions, or task results."
    );
  });

  it("builds the intent resolution prompt with the original routing rules", () => {
    const prompt = buildIntentResolutionPrompt({
      text: "Show me what is on my desktop"
    });

    expect(prompt).toContain(
      "Classify the user's final utterance into exactly one intent."
    );
    expect(prompt).toContain(
      "Use task_request when answering requires inspecting local files, directories, apps, browser state, or running local tools or commands."
    );
    expect(prompt).toContain("Utterance: Show me what is on my desktop");
  });

  it("builds task intake prompts for both start and update flows", () => {
    const startPrompt = buildTaskIntakeStartPrompt({
      text: "Clean up the downloads folder"
    });
    const updatePrompt = buildTaskIntakeUpdatePrompt({
      session: {
        brainSessionId: "brain-1",
        status: "collecting",
        sourceText: "Clean up the downloads folder",
        workingText: "Clean up the downloads folder",
        requiredSlots: ["scope"],
        filledSlots: { location: "downloads folder" },
        missingSlots: ["scope"],
        lastQuestion: "Tell me what rule or scope to use.",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z"
      },
      text: "group by file type"
    });

    expect(startPrompt).toContain("Analyze a user request for task intake.");
    expect(startPrompt).toContain(
      'Treat file inspection requests like "check my desktop and tell me the names and counts of folders and files" as immediately executable.'
    );
    expect(updatePrompt).toContain(
      '- "replace_task" if the message is a new standalone task request that should replace the current intake.'
    );
    expect(updatePrompt).toContain("Currently missing slots: scope");
    expect(updatePrompt).toContain("Latest user message: group by file type");
  });

  it("builds the task routing prompt with examples and serialized context buckets", () => {
    const prompt = buildTaskRoutingPrompt({
      utteranceIntent: "task_request",
      utteranceText:
        "Create a txt file with current LLM news in the LLM folder you created earlier",
      delegateMode: "auto",
      explicitTaskId: null,
      activeTasksJson: "[]",
      recentCompletedTasksJson:
        '[{"id":"task-1","isRecentCompleted":true,"latestEventPreview":"Desktop/LLM folder creation Completed"}]',
      otherRecentTasksJson: "[]"
    });

    expect(prompt).toContain(
      "Prefer create_task when the user references the result of a recently completed task and asks for a new action."
    );
    expect(prompt).toContain(
      'Example: "How far along is that folder task?" -> status.'
    );
    expect(prompt).toContain(
      'Recent completed tasks: [{"id":"task-1","isRecentCompleted":true,"latestEventPreview":"Desktop/LLM folder creation Completed"}]'
    );
  });

  it("builds the session memory extraction prompt with the original schema contract", () => {
    const prompt = buildSessionMemoryExtractionPrompt({
      existingItemsJson:
        '[{"kind":"identity","key":"preferred_name","summary":"Preferred name: Sam","importance":"high"}]',
      text: "Call me Sam and keep answers short."
    });

    expect(prompt).toContain(
      "You decide what session memory to save for Relay, an English-speaking voice agent for the Google ecosystem."
    );
    expect(prompt).toContain(
      "Return at most 3 items."
    );
    expect(prompt).toContain(
      'Return schema: {"storeItems":[{"kind":"identity|preference|workflow|constraint|background|current_context","key":"string","summary":"string","valueText":"string","importance":"high|medium|low","confidence":0.0}]}'
    );
    expect(prompt).toContain(
      "Latest user utterance: Call me Sam and keep answers short."
    );
  });
});
