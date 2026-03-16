import type { Task, TaskEvent } from "@agent/shared-types";
import { englishOnlyDetail } from "./english-only-text.js";

export function buildTaskStatusMessage(
  task: Task,
  latestEvent?: TaskEvent
): string {
  if (task.status === "completed") {
    const detailedAnswer = englishOnlyDetail(task.completionReport?.detailedAnswer);
    if (detailedAnswer) {
      return detailedAnswer;
    }
  }

  const summary = englishOnlyDetail(task.completionReport?.summary);
  if (summary) {
    return summary;
  }

  const eventMessage = englishOnlyDetail(latestEvent?.message);
  if (eventMessage) {
    return eventMessage;
  }

  switch (task.status) {
    case "queued":
      return "The task is queued.";
    case "running":
      return "The task is still running.";
    case "waiting_input":
      return "The task needs more input to continue.";
    case "approval_required":
      return "The task needs approval to continue.";
    case "completed":
      return "The task is complete.";
    case "failed":
      return "The task failed.";
    case "cancelled":
      return "The task was cancelled.";
    default:
      return "I checked the task status.";
  }
}
