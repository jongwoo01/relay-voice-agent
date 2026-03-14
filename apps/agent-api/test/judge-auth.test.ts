import { describe, expect, it } from "vitest";
import {
  issueJudgeSessionToken,
  verifyJudgeSessionToken
} from "../src/server/judge-auth.js";

describe("judge-auth", () => {
  it("issues and verifies a signed judge session token", () => {
    const token = issueJudgeSessionToken(
      {
        brainSessionId: "brain-1",
        userId: "user-1",
        exp: 2_000_000_000
      },
      "secret"
    );

    expect(verifyJudgeSessionToken(token, "secret", 1_900_000_000)).toEqual({
      brainSessionId: "brain-1",
      userId: "user-1",
      exp: 2_000_000_000
    });
  });

  it("rejects an expired or tampered token", () => {
    const token = issueJudgeSessionToken(
      {
        brainSessionId: "brain-2",
        userId: "user-2",
        exp: 1_700_000_000
      },
      "secret"
    );

    expect(verifyJudgeSessionToken(token, "secret", 1_800_000_000)).toBeNull();
    expect(verifyJudgeSessionToken(`${token}tampered`, "secret")).toBeNull();
  });
});
