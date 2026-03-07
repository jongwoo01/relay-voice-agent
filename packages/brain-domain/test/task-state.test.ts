import { describe, expect, it } from "vitest";
import { canTransitionTask, reduceTaskStatus } from "../src/task-state.js";

describe("task-state", () => {
  it("allows a normal created -> queued -> running flow", () => {
    expect(canTransitionTask("created", "queued")).toBe(true);
    expect(reduceTaskStatus("created", "queued")).toBe("queued");
    expect(reduceTaskStatus("queued", "running")).toBe("running");
  });

  it("rejects invalid transitions", () => {
    expect(() => reduceTaskStatus("created", "completed")).toThrow(
      "Invalid task transition"
    );
  });
});
