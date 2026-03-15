import type {
  AssistantEnvelope,
  FinalizedUtterance,
  IntentType,
  Task,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import {
  createDefaultIntentResolver,
  type IntentResolver
} from "../conversation/intent-resolver.js";
import { RealtimeGatewayService } from "../realtime/realtime-gateway-service.js";
import { mergeStreamingTranscript } from "./transcript-merge.js";

export interface LiveTranscriptInput {
  brainSessionId: string;
  text: string;
  createdAt: string;
  now: string;
  isFinal: boolean;
  intentHint?: IntentType;
}

export interface LiveTranscriptResult {
  isFinal: boolean;
  partialText?: string;
  finalizedUtterance?: FinalizedUtterance;
  assistant?: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export class LiveTranscriptAdapter {
  private readonly partialBySession = new Map<string, string>();

  constructor(
    private readonly gateway: RealtimeGatewayService = new RealtimeGatewayService(),
    private readonly resolveIntent: IntentResolver = createDefaultIntentResolver()
  ) {}

  async handleTranscript(
    input: LiveTranscriptInput
  ): Promise<LiveTranscriptResult> {
    const rawText = typeof input.text === "string" ? input.text : "";
    const normalizedText = rawText.trim();

    if (!input.isFinal) {
      const previousPartial = this.partialBySession.get(input.brainSessionId) ?? "";
      const mergedPartial =
        rawText.length > 0
          ? mergeStreamingTranscript(previousPartial, rawText)
          : previousPartial;

      if (rawText.length > 0) {
        this.partialBySession.set(input.brainSessionId, mergedPartial);
      }

      return {
        isFinal: false,
        partialText: mergedPartial || this.partialBySession.get(input.brainSessionId)
      };
    }

    const previousPartial = this.partialBySession.get(input.brainSessionId) ?? "";
    const finalizedText = mergeStreamingTranscript(previousPartial, normalizedText).trim();
    this.partialBySession.delete(input.brainSessionId);

    if (!finalizedText) {
      return { isFinal: true };
    }

    const utterance: FinalizedUtterance = {
      text: finalizedText,
      ...(input.intentHint
        ? { intent: input.intentHint }
        : await this.resolveIntent.resolve(finalizedText)),
      createdAt: input.createdAt
    };

    const result = await this.gateway.handleFinalizedUtterance({
      brainSessionId: input.brainSessionId,
      utterance,
      now: input.now
    });

    return {
      isFinal: true,
      finalizedUtterance: utterance,
      assistant: result.assistant,
      task: result.task,
      taskEvents: result.taskEvents,
      executorSession: result.executorSession
    };
  }

  getPartialText(brainSessionId: string): string | undefined {
    return this.partialBySession.get(brainSessionId);
  }

  resetSession(brainSessionId: string): void {
    this.partialBySession.delete(brainSessionId);
  }
}
