import type { Task } from "@agent/shared-types";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isContinuationCue(text: string): boolean {
  return /아까|이어서|계속|하던|그거|저거|continue|resume/i.test(text);
}

function isShortFollowUpCue(normalizedText: string): boolean {
  if (!normalizedText) {
    return false;
  }

  if (
    /^(줘|해|해줘|줘요|해요|보여줘|알려줘|계속|이어줘|이어서|그거|저거|go on|next)$/.test(
      normalizedText
    )
  ) {
    return true;
  }

  return normalizedText.length <= 8 && /(결과|진행|상태).*(줘|알려줘|보여줘)/.test(
    normalizedText
  );
}

export function selectContinuationTask(
  utteranceText: string,
  activeTasks: Task[]
): Task | null {
  if (activeTasks.length === 0) {
    return null;
  }

  if (isContinuationCue(utteranceText)) {
    return activeTasks[0] ?? null;
  }

  const normalizedUtterance = normalize(utteranceText);
  if (isShortFollowUpCue(normalizedUtterance)) {
    return activeTasks[0] ?? null;
  }

  for (const task of activeTasks) {
    if (
      normalizedUtterance.includes(task.normalizedGoal) ||
      task.normalizedGoal.includes(normalizedUtterance)
    ) {
      return task;
    }
  }

  return null;
}
