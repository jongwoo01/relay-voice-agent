import type { FinalizedUtterance, NextAction, Task } from "@agent/shared-types";
import { selectContinuationTask } from "./continuation.js";

export function decideNextAction(
  utterance: FinalizedUtterance,
  activeTasks: Task[]
): NextAction {
  const continuationTask = selectContinuationTask(utterance.text, activeTasks);
  if (continuationTask) {
    return { type: "resume_task", taskId: continuationTask.id };
  }

  if (utterance.intent === "small_talk" || utterance.intent === "question") {
    return { type: "reply" };
  }

  if (utterance.intent === "unclear") {
    return { type: "clarify" };
  }

  return { type: "create_task" };
}
