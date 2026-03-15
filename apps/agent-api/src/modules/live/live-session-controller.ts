import type {
  AssistantEnvelope,
  FinalizedUtterance,
  IntentType,
  Task,
  TaskEvent,
  TaskExecutorSession
} from "@agent/shared-types";
import {
  LiveTranscriptAdapter,
  type LiveTranscriptInput,
  type LiveTranscriptResult
} from "./live-transcript-adapter.js";

export interface LiveTranscriptChunk {
  text: string;
  createdAt: string;
  isFinal: boolean;
  intentHint?: IntentType;
}

export interface LiveSessionTurnResult {
  partialText?: string;
  finalizedUtterance?: FinalizedUtterance;
  assistant?: AssistantEnvelope;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export class LiveSessionController {
  constructor(
    private readonly transcriptAdapter: LiveTranscriptAdapter = new LiveTranscriptAdapter()
  ) {}

  async handleTranscriptChunk(input: {
    brainSessionId: string;
    chunk: LiveTranscriptChunk;
    now: string;
  }): Promise<LiveSessionTurnResult> {
    const result = await this.transcriptAdapter.handleTranscript({
      brainSessionId: input.brainSessionId,
      text: input.chunk.text,
      createdAt: input.chunk.createdAt,
      now: input.now,
      isFinal: input.chunk.isFinal,
      intentHint: input.chunk.intentHint
    });

    return this.toTurnResult(result);
  }

  resetSession(brainSessionId: string): void {
    this.transcriptAdapter.resetSession(brainSessionId);
  }

  clearPartial(brainSessionId: string): void {
    this.transcriptAdapter.clearPartial(brainSessionId);
  }

  private toTurnResult(result: LiveTranscriptResult): LiveSessionTurnResult {
    if (!result.isFinal) {
      return {
        partialText: result.partialText
      };
    }

    return {
      finalizedUtterance: result.finalizedUtterance,
      assistant: result.assistant,
      task: result.task,
      taskEvents: result.taskEvents,
      executorSession: result.executorSession
    };
  }
}
