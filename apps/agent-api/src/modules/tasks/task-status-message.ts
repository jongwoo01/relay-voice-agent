import type { Task, TaskEvent } from "@agent/shared-types";

export function buildTaskStatusMessage(
  task: Task,
  latestEvent?: TaskEvent
): string {
  if (task.completionReport?.summary) {
    return task.completionReport.summary;
  }

  if (latestEvent?.message) {
    return latestEvent.message;
  }

  switch (task.status) {
    case "queued":
      return "작업을 큐에 넣었어요.";
    case "running":
      return "작업을 계속 확인하고 있어요.";
    case "waiting_input":
      return "작업을 이어가려면 입력이 더 필요해요.";
    case "approval_required":
      return "작업을 이어가려면 승인이 필요해요.";
    case "completed":
      return "작업이 완료됐어요.";
    case "failed":
      return "작업이 실패했어요.";
    default:
      return "작업 상태를 확인했어요.";
  }
}
