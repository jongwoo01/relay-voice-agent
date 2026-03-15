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
import { StreamingTranscriptAccumulator } from "./streaming-transcript-accumulator.js";

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
  private readonly accumulator = new StreamingTranscriptAccumulator();

  constructor(
    private readonly gateway: RealtimeGatewayService = new RealtimeGatewayService(),
    private readonly resolveIntent: IntentResolver = createDefaultIntentResolver()
  ) {}

  async handleTranscript(
    input: LiveTranscriptInput
  ): Promise<LiveTranscriptResult> {
    const transcript = this.accumulator.handleChunk({
      sessionKey: input.brainSessionId,
      text: input.text,
      isFinal: input.isFinal
    });

    if (!input.isFinal) {
      return {
        isFinal: false,
        partialText: transcript.partialText
      };
    }

    const finalizedText = transcript.finalizedText ?? "";

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
    return this.accumulator.getPartialText(brainSessionId);
  }

  clearPartial(brainSessionId: string): void {
    this.accumulator.clearPartial(brainSessionId);
  }

  resetSession(brainSessionId: string): void {
    this.accumulator.resetSession(brainSessionId);
  }
}
