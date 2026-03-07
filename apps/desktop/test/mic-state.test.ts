import { describe, expect, it } from "vitest";
import {
  createInitialMicState,
  toggleMicState
} from "../src/shared/mic-state.js";

describe("mic-state", () => {
  it("starts enabled and idle", () => {
    expect(createInitialMicState()).toEqual({
      enabled: true,
      mode: "idle"
    });
  });

  it("toggles between idle and muted", () => {
    const muted = toggleMicState(createInitialMicState());
    expect(muted).toEqual({
      enabled: false,
      mode: "muted"
    });

    expect(toggleMicState(muted)).toEqual({
      enabled: true,
      mode: "idle"
    });
  });
});
