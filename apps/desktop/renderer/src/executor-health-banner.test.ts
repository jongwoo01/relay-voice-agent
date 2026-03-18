import { describe, expect, it } from "vitest";
import {
  buildExecutorHealthBannerModel,
  classifyExecutorHealthTone
} from "./executor-health-banner.js";

describe("executor-health-banner", () => {
  it("does not show a banner before the first health check starts", () => {
    expect(
      classifyExecutorHealthTone({
        status: "unknown",
        code: null
      })
    ).toBeNull();

    expect(
      buildExecutorHealthBannerModel(
        {
          status: "unknown",
          code: null,
          summary: "Gemini CLI health has not been checked yet.",
          detail: "Relay can run a lightweight Gemini CLI probe and show the result here.",
          checkedAt: null
        },
        "darwin"
      )
    ).toBeNull();
  });

  it("does not show a banner while the health check is still running", () => {
    expect(
      classifyExecutorHealthTone({
        status: "checking",
        code: null
      })
    ).toBeNull();

    expect(
      buildExecutorHealthBannerModel(
        {
          status: "checking",
          code: null,
          summary: "Gemini CLI health check is running.",
          detail: "Relay is waiting for the local probe to finish.",
          checkedAt: "2026-03-16T00:00:00.000Z"
        },
        "darwin"
      )
    ).toBeNull();
  });

  it("builds a lock/session banner model for unhealthy executor states", () => {
    const model = buildExecutorHealthBannerModel(
      {
        status: "unhealthy",
        code: "missing_binary",
        summary: "Gemini CLI is not available locally.",
        detail: "Install Gemini CLI, then retry the health check.",
        checkedAt: "2026-03-16T00:00:00.000Z"
      },
      "darwin"
    );

    expect(model).toEqual(
      expect.objectContaining({
        tone: "error",
        title: "Gemini CLI is not available locally.",
        showRetry: true,
        showSettingsShortcut: true,
        showPrivacyShortcut: false
      })
    );
  });

  it("marks permission-based health failures as warning banners", () => {
    expect(
      classifyExecutorHealthTone({
        status: "unhealthy",
        code: "permission_denied"
      })
    ).toBe("warning");

    expect(
      buildExecutorHealthBannerModel(
        {
          status: "unhealthy",
          code: "permission_denied",
          summary: "Local permissions are blocking Gemini CLI.",
          detail: "Grant the required OS permissions and retry.",
          checkedAt: "2026-03-16T00:00:00.000Z"
        },
        "darwin"
      )
    ).toEqual(
      expect.objectContaining({
        showPrivacyShortcut: true,
        privacySection: "files"
      })
    );
  });
});
