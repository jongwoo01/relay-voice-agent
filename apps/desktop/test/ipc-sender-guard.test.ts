import { describe, expect, it } from "vitest";
import {
  assertTrustedSenderUrl,
  isTrustedSenderUrl
} from "../src/main/ipc/sender-guard.js";

describe("ipc-sender-guard", () => {
  it("accepts the allowed renderer url only", () => {
    const allowed = "file:///Users/jongwoo/Desktop/projects/gemini_live_agent/apps/desktop/renderer/index.html";

    expect(isTrustedSenderUrl(allowed, allowed)).toBe(true);
    expect(
      isTrustedSenderUrl("file:///tmp/untrusted.html", allowed)
    ).toBe(false);
  });

  it("throws for an untrusted sender url", () => {
    const allowed = "file:///trusted";

    expect(() =>
      assertTrustedSenderUrl("file:///untrusted", allowed)
    ).toThrowError(/untrusted sender/i);
  });
});
