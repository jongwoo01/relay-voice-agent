import type { Task } from "@agent/shared-types";

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
        speechText: task.completionReport.summary || message,
        allowLiveModelOutput: false
      };
    }

    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        task.completionReport?.summary ||
        "작업은 끝났지만 실제 결과 확인이 더 필요해요.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "failed") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message || "작업이 실패했어요.",
      allowLiveModelOutput: false
    };
  }

  if (task.status === "waiting_input" || task.status === "approval_required") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText: message,
      allowLiveModelOutput: false
    };
  }

  if (task.status === "queued" || task.status === "running" || task.status === "created") {
    return {
      ownership: "runtime",
      speechMode: "canonical",
      speechText:
        action === "created" || action === "resumed"
          ? "작업을 시작했어요. 완료나 실패가 확인되면 바로 알려드릴게요."
          : "아직 진행 중입니다. 완료나 실패가 확인되면 바로 알려드릴게요.",
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
