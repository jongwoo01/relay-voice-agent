import { describe, expect, it } from "vitest";
import {
  isCompletionNotificationRequest,
  selectContinuationTask
} from "../src/continuation.js";
import type { Task } from "@agent/shared-types";

const activeTask: Task = {
  id: "task-1",
  title: "Browser cleanup",
  normalizedGoal: "browser cleanup",
  status: "running",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z"
};

describe("continuation", () => {
  it("selects the current task when the utterance clearly asks to continue", () => {
    expect(selectContinuationTask("아까 하던 거 계속해", [activeTask])).toEqual(activeTask);
  });

  it("selects the current task for short follow-up cues", () => {
    expect(selectContinuationTask("줘", [activeTask])).toEqual(activeTask);
    expect(selectContinuationTask("결과 알려줘", [activeTask])).toEqual(activeTask);
  });

  it("returns null when there is no active task match", () => {
    expect(selectContinuationTask("오늘 일정 알려줘", [activeTask])).toBeNull();
  });

  it("detects completion notification preference utterances", () => {
    expect(isCompletionNotificationRequest("완료되면 알려줘")).toBe(true);
    expect(isCompletionNotificationRequest("끝나면 보고해")).toBe(true);
    expect(isCompletionNotificationRequest("지금 상태 알려줘")).toBe(false);
  });
});
