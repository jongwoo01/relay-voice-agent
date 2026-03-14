import type { TaskIntakeSession, TaskIntakeSlot } from "@agent/shared-types";

export type TaskIntakeFilledSlots = Partial<Record<TaskIntakeSlot, string>>;

export interface TaskIntakeAnalysis {
  requiredSlots: TaskIntakeSlot[];
  filledSlots: TaskIntakeFilledSlots;
}

function computeMissingSlots(
  requiredSlots: TaskIntakeSlot[],
  filledSlots: TaskIntakeFilledSlots
): TaskIntakeSlot[] {
  return requiredSlots.filter((slot) => !filledSlots[slot]);
}

function appendWorkingText(
  workingText: string,
  filledSlots: TaskIntakeFilledSlots
): string {
  const normalize = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, " ");
  let next = workingText.trim();
  let appended = false;

  for (const value of Object.values(filledSlots)) {
    if (!value) {
      continue;
    }

    const normalizedValue = normalize(value);
    if (!normalize(next).includes(normalizedValue)) {
      next = `${next} ${value}`.trim();
      appended = true;
    }
  }

  return appended ? next : workingText.trim();
}

export function buildTaskIntakeSession(
  text: string,
  brainSessionId: string,
  now: string,
  analysis: TaskIntakeAnalysis
): TaskIntakeSession {
  const sourceText = text.trim();
  const requiredSlots = analysis.requiredSlots;
  const filledSlots = analysis.filledSlots;
  const missingSlots = computeMissingSlots(requiredSlots, filledSlots);

  return {
    brainSessionId,
    status: missingSlots.length === 0 ? "ready" : "collecting",
    sourceText,
    workingText: sourceText,
    requiredSlots,
    filledSlots,
    missingSlots,
    createdAt: now,
    updatedAt: now
  };
}

export function mergeTaskIntakeAnswer(
  session: TaskIntakeSession,
  _answerText: string,
  now: string,
  filledSlotPatch: TaskIntakeFilledSlots
): TaskIntakeSession {
  const newlyFilled = filledSlotPatch;
  const filledSlots = {
    ...session.filledSlots,
    ...newlyFilled
  };
  const missingSlots = computeMissingSlots(session.requiredSlots, filledSlots);

  return {
    ...session,
    status: missingSlots.length === 0 ? "ready" : "collecting",
    filledSlots,
    missingSlots,
    workingText: appendWorkingText(
      session.workingText,
      newlyFilled
    ),
    updatedAt: now
  };
}

export function isTaskIntakeREADY(session: TaskIntakeSession): boolean {
  return session.missingSlots.length === 0;
}

export function buildExecutableTaskText(session: TaskIntakeSession): string {
  return session.workingText;
}
