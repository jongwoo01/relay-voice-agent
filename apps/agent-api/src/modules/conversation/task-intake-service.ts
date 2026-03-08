import {
  buildExecutableTaskText,
  buildTaskIntakeSession,
  isTaskIntakeReady,
  looksLikeStandaloneTaskRequest,
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
      return "어디까지 할지";
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

export interface HandleTaskIntakeInput {
  brainSessionId: string;
  utterance: FinalizedUtterance;
  activeTasks: Task[];
  now: string;
}

export class TaskIntakeService {
  constructor(
    private readonly repository: TaskIntakeRepository,
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator()
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
      if (
        input.utterance.intent === "task_request" &&
        looksLikeStandaloneTaskRequest(input.utterance.text)
      ) {
        const replacement = buildTaskIntakeSession(
          input.utterance.text,
          input.brainSessionId,
          input.now
        );
        return this.persistAndResolve(replacement);
      }

      const merged = mergeTaskIntakeAnswer(
        active,
        input.utterance.text,
        input.now
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

    const session = buildTaskIntakeSession(
      input.utterance.text,
      input.brainSessionId,
      input.now
    );
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
    return {
      kind: "clarify",
      session: collectingSession,
      replyText
    };
  }
}
