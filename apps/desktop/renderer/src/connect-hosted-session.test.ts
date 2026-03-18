import { describe, expect, it, vi } from "vitest";
import {
  connectHostedSession,
  normalizeJudgePasscode
} from "./connect-hosted-session.js";

describe("connectHostedSession", () => {
  it("rejects an empty judge passcode before any connection work starts", async () => {
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn();
    const connect = vi.fn();
    const startVoiceCapture = vi.fn();
    const stopVoiceCapture = vi.fn();
    const disconnect = vi.fn();

    const connected = await connectHostedSession({
      passcode: "   ",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(false);
    expect(hideRuntimeError).not.toHaveBeenCalled();
    expect(showRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Enter the judge passcode to connect."
      })
    );
    expect(stopPlayback).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(startVoiceCapture).not.toHaveBeenCalled();
    expect(stopVoiceCapture).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("prompts for microphone access before opening the hosted session", async () => {
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const requestMicrophoneAccess = vi.fn(async () => true);
    const startVoiceCapture = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const connected = await connectHostedSession({
      passcode: " judge-passcode ",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      requestMicrophoneAccess,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(true);
    expect(hideRuntimeError).toHaveBeenCalledTimes(1);
    expect(requestMicrophoneAccess).toHaveBeenCalledTimes(1);
    expect(requestMicrophoneAccess.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[0]
    );
    expect(connect).toHaveBeenCalledWith("judge-passcode");
    expect(startVoiceCapture).toHaveBeenCalledTimes(1);
    expect(showRuntimeError).not.toHaveBeenCalled();
    expect(stopVoiceCapture).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("applies the configured initial muted state after voice capture starts", async () => {
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const requestMicrophoneAccess = vi.fn(async () => true);
    const startVoiceCapture = vi.fn(async () => undefined);
    const setMuted = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const connected = await connectHostedSession({
      passcode: "judge-passcode",
      startMuted: true,
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      setMuted,
      requestMicrophoneAccess,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(true);
    expect(startVoiceCapture).toHaveBeenCalledTimes(1);
    expect(setMuted).toHaveBeenCalledWith(true);
  });

  it("skips microphone access and starts muted when voice capture is disabled", async () => {
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const requestMicrophoneAccess = vi.fn(async () => true);
    const setMuted = vi.fn(async () => undefined);
    const startVoiceCapture = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const connected = await connectHostedSession({
      passcode: "judge-passcode",
      microphoneEnabled: false,
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      requestMicrophoneAccess,
      setMuted,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(true);
    expect(connect).toHaveBeenCalledWith("judge-passcode");
    expect(requestMicrophoneAccess).not.toHaveBeenCalled();
    expect(startVoiceCapture).not.toHaveBeenCalled();
    expect(setMuted).toHaveBeenCalledWith(true);
  });

  it("fails before connecting when microphone access is denied", async () => {
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const requestMicrophoneAccess = vi.fn(async () => false);
    const startVoiceCapture = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const connected = await connectHostedSession({
      passcode: "judge-passcode",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      requestMicrophoneAccess,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(false);
    expect(showRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Microphone access is required to start the hosted session."
      })
    );
    expect(connect).not.toHaveBeenCalled();
    expect(startVoiceCapture).not.toHaveBeenCalled();
    expect(stopVoiceCapture).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("cleans up after a failed connection attempt", async () => {
    const failure = new Error("Invalid passcode");
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const connect = vi.fn(async () => {
      throw failure;
    });
    const startVoiceCapture = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const connected = await connectHostedSession({
      passcode: "judge-passcode",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(connected).toBe(false);
    expect(showRuntimeError).toHaveBeenCalledWith(failure);
    expect(stopVoiceCapture).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(startVoiceCapture).not.toHaveBeenCalled();
  });

  it("can recover cleanly after an invalid passcode attempt and start voice capture on retry", async () => {
    const invalidPasscode = new Error("Invalid passcode");
    const hideRuntimeError = vi.fn();
    const showRuntimeError = vi.fn();
    const stopPlayback = vi.fn(async () => undefined);
    const requestMicrophoneAccess = vi.fn(async () => true);
    const connect = vi
      .fn()
      .mockRejectedValueOnce(invalidPasscode)
      .mockResolvedValueOnce(undefined);
    const startVoiceCapture = vi.fn(async () => undefined);
    const setMuted = vi.fn(async () => undefined);
    const stopVoiceCapture = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const firstAttempt = await connectHostedSession({
      passcode: "wrong-passcode",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      setMuted,
      requestMicrophoneAccess,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    const secondAttempt = await connectHostedSession({
      passcode: "judge-passcode",
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect,
      setMuted,
      requestMicrophoneAccess,
      startVoiceCapture,
      stopVoiceCapture,
      disconnect
    });

    expect(firstAttempt).toBe(false);
    expect(secondAttempt).toBe(true);
    expect(requestMicrophoneAccess).toHaveBeenCalledTimes(2);
    expect(startVoiceCapture).toHaveBeenCalledTimes(1);
    expect(setMuted).toHaveBeenCalledWith(false);
    expect(stopVoiceCapture).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(showRuntimeError).toHaveBeenCalledWith(invalidPasscode);
  });
});

describe("normalizeJudgePasscode", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeJudgePasscode(" judge-passcode ")).toBe("judge-passcode");
  });
});
