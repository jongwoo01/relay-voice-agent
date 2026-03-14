import {
  buildExecutableTaskText,
  buildTaskIntakeSession,
  isTaskIntakeREADY,
  mergeTaskIntakeAnswer
} from "@agent/brain-domain";
import type {
  FinalizedUtterance,
  Task,
  TaskIntakeSession,
  TaskIntakeSlot
} from "@agent/shared-types";
import type { TaskIntakeRepository } from "../persistence/task-intake-repository.js";
import {
  createDefaultTaskIntakeResolver,
  type TaskIntakeResolver
} from "./task-intake-resolver.js";

export type TaskIntakeResolution =
  | { kind: "not_applicable" }
  | { kind: "clarify"; session: TaskIntakeSession; replyText: string }
  | { kind: "ready"; session: TaskIntakeSession; executableText: string }
  | { kind: "cancelled"; replyText: string };

function describeMissingSlot(slot: TaskIntakeSlot): string {
  switch (slot) {
    case "target":
      return "who it is for";
    case "location":
      return "where it should run";
    case "time":
      return "when it should happen";
    case "scope":
      return "what rule or scope to use";
    case "risk_ack":
      return "whether destructive changes are okay";
    default:
      return "the missing detail";
  }
}

function prioritizeMissingSlots(missingSlots: TaskIntakeSlot[]): TaskIntakeSlot[] {
  const priority: TaskIntakeSlot[] = [
    "target",
    "location",
    "time",
    "scope",
    "risk_ack"
  ];

  return [...missingSlots].sort(
    (left, right) => priority.indexOf(left) - priority.indexOf(right)
  );
}

function buildQuestionText(missingSlots: TaskIntakeSlot[]): string {
  const prioritized = prioritizeMissingSlots(missingSlots);
  const visible = prioritized.slice(0, 2).map(describeMissingSlot);

  if (visible.length === 0) {
    return "I can start right away. If I need more detail, I'll ask a follow-up.";
  }

  if (visible.length === 1) {
    return `Tell me ${visible[0]}.`;
  }

  return `Tell me ${visible[0]} and ${visible[1]} first.`;
}

function withQuestion(
  session: TaskIntakeSession,
  replyText: string
): TaskIntakeSession {
  return {
    ...session,
    lastQuestion: replyText
  };
}

function logTaskIntake(label: string, details: Record<string, unknown>): void {
  console.log(`[task-intake] ${label} ${JSON.stringify(details)}`);
}

export interface HandleTaskIntakeInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  activeTasks: Task[];
  now: string;
}

export class TaskIntakeService {
  constructor(
    private readonly repository: TaskIntakeRepository,
    private readonly resolver: TaskIntakeResolver = createDefaultTaskIntakeResolver()
  ) {}

  async getActive(brainSessionId: string): Promise<TaskIntakeSession | null> {
    return this.repository.getActiveByBrainSessionId(brainSessionId);
  }

  async clear(brainSessionId: string): Promise<void> {
    await this.repository.clearActive(brainSessionId);
  }

  async handleTurn(
    input: HandleTaskIntakeInput
  ): Promise<TaskIntakeResolution> {
    const active = await this.repository.getActiveByBrainSessionId(
      input.brainSessionId
    );

    if (active) {
      const updateAnalysis = await this.resolver.analyzeUpdate(
        active,
        input.utterance.text
      );
      logTaskIntake("update analysis", {
        brainSessionId: input.brainSessionId,
        utterance: input.utterance.text,
        activeSourceText: active.sourceText,
        resolution: updateAnalysis.resolution,
        requiredSlots: updateAnalysis.requiredSlots,
        filledSlots: updateAnalysis.filledSlots
      });

      if (updateAnalysis.resolution === "replace_task") {
        const replacement = buildTaskIntakeSession(
          input.utterance.text,
          input.brainSessionId,
          input.now,
          {
            requiredSlots: updateAnalysis.requiredSlots,
            filledSlots: updateAnalysis.filledSlots
          }
        );
        return this.persistAndResolve(replacement);
      }

      const merged = mergeTaskIntakeAnswer(
        active,
        input.utterance.text,
        input.now,
        updateAnalysis.filledSlots
      );
      return this.persistAndResolve(merged);
    }

    if (input.utterance.intent !== "task_request") {
      return { kind: "not_applicable" };
    }

    const startAnalysis = await this.resolver.analyzeStart(input.utterance.text);
    logTaskIntake("start analysis", {
      brainSessionId: input.brainSessionId,
      utterance: input.utterance.text,
      requiredSlots: startAnalysis.requiredSlots,
      filledSlots: startAnalysis.filledSlots
    });
    const session = buildTaskIntakeSession(input.utterance.text, input.brainSessionId, input.now, {
      requiredSlots: startAnalysis.requiredSlots,
      filledSlots: startAnalysis.filledSlots
    });
    return this.persistAndResolve(session);
  }

  private async persistAndResolve(
    session: TaskIntakeSession
  ): Promise<TaskIntakeResolution> {
    if (isTaskIntakeREADY(session)) {
      const readySession = {
        ...session,
        status: "ready" as const
      };
      await this.repository.save(readySession);
      logTaskIntake("resolved ready", {
        brainSessionId: session.brainSessionId,
        workingText: readySession.workingText,
        requiredSlots: readySession.requiredSlots,
        filledSlots: readySession.filledSlots
      });
      return {
        kind: "ready",
        session: readySession,
        executableText: buildExecutableTaskText(readySession)
      };
    }

    const replyText = buildQuestionText(session.missingSlots);
    const collectingSession = withQuestion(
      {
        ...session,
        status: "collecting"
      },
      replyText
    );
    await this.repository.save(collectingSession);
    logTaskIntake("resolved clarify", {
      brainSessionId: session.brainSessionId,
      workingText: collectingSession.workingText,
      missingSlots: collectingSession.missingSlots,
      lastQuestion: replyText
    });
    return {
      kind: "clarify",
      session: collectingSession,
      replyText
    };
  }
}
