import { describe, expect, it } from "vitest";
import { mergeStreamingTranscript } from "../src/modules/live/transcript-merge.js";

describe("mergeStreamingTranscript", () => {
  it("joins short leading fragments that continue the same word", () => {
    expect(mergeStreamingTranscript("in", "troduce yourself")).toBe(
      "introduce yourself"
    );
    expect(mergeStreamingTranscript("set", "tings")).toBe("settings");
  });

  it("preserves normal English word boundaries", () => {
    expect(mergeStreamingTranscript("open the", "browser")).toBe("open the browser");
    expect(mergeStreamingTranscript("go to", "settings")).toBe("go to settings");
    expect(mergeStreamingTranscript("show my", "files")).toBe("show my files");
    expect(mergeStreamingTranscript("open", "browser")).toBe("open browser");
    expect(mergeStreamingTranscript("ask", "me later")).toBe("ask me later");
  });
});
