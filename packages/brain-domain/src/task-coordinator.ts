import type { Task, TaskTransitionResult } from "@agent/shared-types";
import { reduceTaskStatus } from "./task-state.js";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 48) {
    return trimmed;
  }

  return `${trimmed.slice(0, 45)}...`;
}

export function createTask(text: string, now: string, taskId: string): TaskTransitionResult {
  const task: Task = {
    id: taskId,
    title: buildTitle(text),
    normalizedGoal: normalize(text),
    status: "created",
    createdAt: now,
    updatedAt: now
  };

  return {
    task,
    event: {
      taskId,
      type: "task_created",
      message: `Task created: ${task.title}`,
      createdAt: now
    }
  };
}

export function queueTask(task: Task, now: string): TaskTransitionResult {
  return {
    task: {
      ...task,
      status: reduceTaskStatus(task.status, "queued"),
      updatedAt: now
    },
    event: {
      taskId: task.id,
      type: "task_queued",
      message: "Task queued for local execution",
      createdAt: now
    }
  };
}

export function startTask(task: Task, now: string, message = "Task is running"): TaskTransitionResult {
  const nextStatus = task.status === "running" ? "running" : reduceTaskStatus(task.status, "running");

  return {
    task: {
      ...task,
      status: nextStatus,
      updatedAt: now
    },
    event: {
      taskId: task.id,
      type: "task_started",
      message,
      createdAt: now
    }
  };
}

export function reportTaskProgress(task: Task, now: string, message: string): TaskTransitionResult {
  const runningTask = task.status === "running" ? task : startTask(task, now, "Task is running").task;

  return {
    task: {
      ...runningTask,
      updatedAt: now
    },
    event: {
      taskId: task.id,
      type: "executor_progress",
      message,
      createdAt: now
    }
  };
}

export function completeTask(task: Task, now: string, message: string): TaskTransitionResult {
  const runningTask = task.status === "running" ? task : startTask(task, now, "Task is running").task;

  return {
    task: {
      ...runningTask,
      status: reduceTaskStatus(runningTask.status, "completed"),
      updatedAt: now
    },
    event: {
      taskId: task.id,
      type: "executor_completed",
      message,
      createdAt: now
    }
  };
}
