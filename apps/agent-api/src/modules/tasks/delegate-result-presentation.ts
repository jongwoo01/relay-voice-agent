import type { Task } from "@agent/shared-types";
import { englishOnlyDetail } from "./english-only-text.js";

export interface DelegateResultPresentation {
  ownership: "live" | "runtime";
  speechMode: "canonical" | "grounded_summary" | "freeform";
  speechText: string;
  allowLiveModelOutput: boolean;
}

export type DelegateResultAction =
  | "clarify"
  | "created"
  | "resumed"
  | "status"
  | "error";

export function buildTaskResultPresentation(input: {
  action: DelegateResultAction;
  task: Task;
  message: string;
}): DelegateResultPresentation {
  const { action, task, message } = input;

  if (task.status === "completed") {
    if (task.completionReport?.verification === "verified") {
      return {
        ownership: "runtime",
        speechMode: "grounded_summary",
        speechText:
          englishOnlyDetail(task.completionReport.summary) ??
          englishOnlyDetail(message) ??
          "The task is done.",
        allowLiveModelOutput: false
      };
    }

    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        englishOnlyDetail(task.completionReport?.summary) ??
        englishOnlyDetail(message) ??
        "The task finished, but I still need to verify the final result.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "failed") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: englishOnlyDetail(message) || "The task failed.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "waiting_input" || task.status === "approval_required") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        englishOnlyDetail(message) ||
        (task.status === "waiting_input"
          ? "I need one more answer to continue."
          : "I need approval before I continue."),
      allowLiveModelOutput: false
    };
  }

  if (task.status === "queued" || task.status === "running" || task.status === "created") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        action === "created" || action === "resumed"
          ? "I started the task. I'll let you know as soon as completion or failure is confirmed."
          : "The task is still running. I'll let you know as soon as completion or failure is confirmed.",
      allowLiveModelOutput: false
    };
  }

  return {
    ownership: "live",
    speechMode: "freeform",
    speechText: message,
    allowLiveModelOutput: true
  };
}

export function buildRuntimePresentation(
  speechText: string
): DelegateResultPresentation {
  return {
    ownership: "runtime",
    speechMode: "canonical",
    speechText,
    allowLiveModelOutput: false
  };
}
