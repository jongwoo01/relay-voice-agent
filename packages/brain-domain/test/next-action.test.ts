import { describe, expect, it } from "vitest";
import { decideNextAction } from "../src/next-action.js";
import type { FinalizedUtterance, Task } from "@agent/shared-types";

const activeTask: Task = {
  id: "task-1",
  title: "Browser cleanup",
  normalizedGoal: "browser cleanup",
  status: "running",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z"
};

function utterance(text: string, intent: FinalizedUtterance["intent"]): FinalizedUtterance {
  return {
    text,
    intent,
    createdAt: "2026-03-07T00:00:00.000Z"
  };
}

describe("next-action", () => {
  it("replies to small talk", () => {
    expect(decideNextAction(utterance("안녕", "small_talk"), [])).toEqual({
      type: "reply"
    });
  });

  it("resumes a running task for short follow-up utterances", () => {
    expect(decideNextAction(utterance("줘", "small_talk"), [activeTask])).toEqual({
      type: "resume_task",
      taskId: "task-1"
    });
  });

  it("sets completion notification preference for completion notice utterances", () => {
    expect(
      decideNextAction(utterance("완료되면 알려줘", "task_request"), [activeTask])
    ).toEqual({
      type: "set_completion_notification",
      taskId: "task-1"
    });
  });

  it("clarifies when the intent is unclear", () => {
    expect(decideNextAction(utterance("음...", "unclear"), [])).toEqual({
      type: "clarify"
    });
  });

  it("requests task intake details when execution-critical time is missing", () => {
    expect(decideNextAction(utterance("일정 잡아줘", "task_request"), [])).toEqual({
      type: "task_intake_clarify",
      missingSlots: ["time"]
    });
  });

  it("requests task intake details when a message target is missing", () => {
    expect(decideNextAction(utterance("메일 보내줘", "task_request"), [])).toEqual({
      type: "task_intake_clarify",
      missingSlots: ["target"]
    });
  });

  it("resumes a task when a continuation cue is present", () => {
    expect(decideNextAction(utterance("아까 하던 거 이어서 해", "task_request"), [activeTask])).toEqual({
      type: "resume_task",
      taskId: "task-1"
    });
  });

  it("creates a new task when no continuation is found", () => {
    expect(decideNextAction(utterance("새로 폴더 정리해줘", "task_request"), [activeTask])).toEqual({
      type: "create_task"
    });
  });

  it("creates a task immediately when the cleanup scope is already clear", () => {
    expect(decideNextAction(utterance("다운로드 폴더 정리해줘", "task_request"), [])).toEqual({
      type: "create_task"
    });
  });
});
