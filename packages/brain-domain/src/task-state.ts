import type { TaskStatus } from "@agent/shared-types";

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  created: ["queued", "cancelled"],
  queued: ["running", "cancelled", "failed"],
  running: ["waiting_input", "approval_required", "completed", "failed", "cancelled"],
  waiting_input: ["running", "approval_required", "cancelled", "failed"],
  approval_required: ["running", "waiting_input", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

export function canTransitionTask(
  from: TaskStatus,
  to: TaskStatus
): boolean {
  return allowedTransitions[from].includes(to);
}

export function reduceTaskStatus(
  current: TaskStatus,
  next: TaskStatus
): TaskStatus {
  if (!canTransitionTask(current, next)) {
    throw new Error(`Invalid task transition: ${current} -> ${next}`);
  }

  return next;
}
