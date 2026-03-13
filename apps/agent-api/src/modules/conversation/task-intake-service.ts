import {
  buildExecutableTaskText,
  buildTaskIntakeSession,
  isTaskIntakeReady,
  mergeTaskIntakeAnswer
} from "@agent/brain-domain";
import type {
  FinalizedUtterance,
  Task,
  TaskIntakeSession,
  TaskIntakeSlot
} from "@agent/shared-types";
import { ConversationOrchestrator } from "./conversation-orchestrator.js";
import type { TaskIntakeRepository } from "../persistence/task-intake-repository.js";
import {
  HeuristicTaskIntakeResolver,
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
      return "누구에게 할지";
    case "location":
      return "어느 위치에서 할지";
    case "time":
      return "언제 할지";
    case "scope":
      return "어떤 기준으로 할지";
    case "risk_ack":
      return "지워도 괜찮은 범위";
    default:
      return "추가 정보";
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
    return "바로 움직일게. 필요한 정보가 있으면 이어서 물어볼게.";
  }

  if (visible.length === 1) {
    return `${visible[0]}만 알려줘.`;
  }

  return `${visible[0]}랑 ${visible[1]}만 먼저 알려줘.`;
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
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator(),
    private readonly resolver: TaskIntakeResolver = new HeuristicTaskIntakeResolver()
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

    const preliminary = this.orchestrator.decide(
      input.utterance,
      input.activeTasks
    );

    if (
      preliminary.type === "reply" ||
      preliminary.type === "clarify" ||
      preliminary.type === "resume_task" ||
      preliminary.type === "set_completion_notification"
    ) {
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
    if (isTaskIntakeReady(session)) {
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
