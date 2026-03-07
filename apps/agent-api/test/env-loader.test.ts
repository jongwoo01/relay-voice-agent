import { describe, expect, it } from "vitest";
import { parseDotEnv } from "../src/modules/config/env-loader.js";

describe("parseDotEnv", () => {
  it("parses plain and quoted entries while ignoring comments", () => {
    const parsed = parseDotEnv(`
# comment
GOOGLE_API_KEY=test-key
LIVE_MODEL="gemini-live"
EMPTY=
INVALID
`);

    expect(parsed).toEqual({
      GOOGLE_API_KEY: "test-key",
      LIVE_MODEL: "gemini-live",
      EMPTY: ""
    });
  });
});
