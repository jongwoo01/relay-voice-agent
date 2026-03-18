import { describe, expect, it, vi } from "vitest";
import {
  formatMicrophoneAccessError,
  requestMicrophoneStream
} from "./microphone-access.js";

describe("requestMicrophoneStream", () => {
  it("uses the selected microphone when it is available", async () => {
    const getUserMedia = vi.fn(async () => ({ id: "stream-1" }));

    const result = await requestMicrophoneStream({
      mediaDevices: { getUserMedia },
      selectedMicId: "mic-1",
      audioConstraints: {
        channelCount: 1
      }
    });

    expect(result).toEqual({
      stream: { id: "stream-1" },
      usedFallbackDevice: false
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        deviceId: { exact: "mic-1" }
      }
    });
  });

  it("falls back to the default microphone when the saved device is gone", async () => {
    const missingDeviceError = new DOMException("Missing microphone", "NotFoundError");
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(missingDeviceError)
      .mockResolvedValueOnce({ id: "fallback-stream" });

    const result = await requestMicrophoneStream({
      mediaDevices: { getUserMedia },
      selectedMicId: "missing-mic",
      audioConstraints: {
        channelCount: 1
      }
    });

    expect(result).toEqual({
      stream: { id: "fallback-stream" },
      usedFallbackDevice: true
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: {
        channelCount: 1
      }
    });
  });
});

describe("formatMicrophoneAccessError", () => {
  it("returns macOS-specific guidance for denied microphone access", () => {
    const error = new DOMException("Blocked", "NotAllowedError");
    const formatted = formatMicrophoneAccessError(error, {
      permissionStatus: "denied"
    });

    expect(formatted.message).toContain("System Settings > Privacy & Security > Microphone");
  });

  it("explains when the selected microphone is no longer available", () => {
    const error = new DOMException("Missing microphone", "NotFoundError");
    const formatted = formatMicrophoneAccessError(error, {
      selectedMicId: "missing-mic"
    });

    expect(formatted.message).toContain("previously selected microphone");
  });
});
