import type { Task } from "@agent/shared-types";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isContinuationCue(text: string): boolean {
  return /아까|이어서|계속|하던|continue|resume/i.test(text);
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
