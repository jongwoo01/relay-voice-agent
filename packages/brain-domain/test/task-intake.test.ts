import { describe, expect, it } from "vitest";
import {
  buildExecutableTaskText,
  buildTaskIntakeSession,
  extractFilledSlots,
  inferRequiredSlots,
  isTaskIntakeReady,
  mergeTaskIntakeAnswer
} from "../src/task-intake.js";

describe("task-intake", () => {
  it("infers only required slots for a task request", () => {
    expect(inferRequiredSlots("메일 보내줘")).toEqual(["target"]);
    expect(inferRequiredSlots("일정 잡아줘")).toEqual(["time"]);
    expect(inferRequiredSlots("다운로드 폴더 정리해줘")).toEqual(["scope"]);
  });

  it("extracts slot values from follow-up answers", () => {
    expect(extractFilledSlots("민수한테 보내줘")).toEqual({
      target: "민수한테 보내줘"
    });
    expect(extractFilledSlots("내일 오후 3시에")).toEqual({
      time: "내일 오후 3시에"
    });
    expect(extractFilledSlots("다운로드 폴더에서 중복 파일만")).toEqual({
      location: "다운로드 폴더에서 중복 파일만",
      scope: "다운로드 폴더에서 중복 파일만"
    });
  });

  it("merges follow-up answers and becomes ready once required slots are filled", () => {
    const session = buildTaskIntakeSession(
      "메일 보내줘",
      "brain-1",
      "2026-03-08T00:00:00.000Z"
    );

    const merged = mergeTaskIntakeAnswer(
      session,
      "민수한테",
      "2026-03-08T00:00:01.000Z"
    );

    expect(merged.filledSlots.target).toBe("민수한테");
    expect(merged.missingSlots).toEqual([]);
    expect(isTaskIntakeReady(merged)).toBe(true);
    expect(buildExecutableTaskText(merged)).toBe("메일 보내줘 민수한테");
  });
});
