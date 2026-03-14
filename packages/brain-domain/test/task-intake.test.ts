import { describe, expect, it } from "vitest";
import {
  buildExecutableTaskText,
  buildTaskIntakeSession,
  isTaskIntakeREADY,
  mergeTaskIntakeAnswer
} from "../src/task-intake.js";

describe("task-intake", () => {
  it("builds a collecting task intake session from LLM analysis", () => {
    const session = buildTaskIntakeSession(
      "Send an email",
      "brain-1",
      "2026-03-08T00:00:00.000Z",
      {
        requiredSlots: ["target"],
        filledSlots: {}
      }
    );

    expect(session.missingSlots).toEqual(["target"]);
    expect(isTaskIntakeREADY(session)).toBe(false);
  });

  it("merges LLM-provided slot patches and becomes ready", () => {
    const session = buildTaskIntakeSession(
      "Send an email",
      "brain-1",
      "2026-03-08T00:00:00.000Z",
      {
        requiredSlots: ["target"],
        filledSlots: {}
      }
    );

    const merged = mergeTaskIntakeAnswer(
      session,
      "to Alex",
      "2026-03-08T00:00:01.000Z",
      {
        target: "to Alex"
      }
    );

    expect(merged.filledSlots.target).toBe("to Alex");
    expect(merged.missingSlots).toEqual([]);
    expect(isTaskIntakeREADY(merged)).toBe(true);
    expect(buildExecutableTaskText(merged)).toBe("Send an email to Alex");
  });
});
