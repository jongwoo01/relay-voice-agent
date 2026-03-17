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

  it("connects with the trimmed judge passcode before prompting for microphone access", async () => {
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
    expect(connect).toHaveBeenCalledWith("judge-passcode");
    expect(requestMicrophoneAccess).toHaveBeenCalledTimes(1);
    expect(connect.mock.invocationCallOrder[0]).toBeLessThan(
      requestMicrophoneAccess.mock.invocationCallOrder[0]
    );
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

  it("disconnects after connect when microphone access is denied", async () => {
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
    expect(connect).toHaveBeenCalledWith("judge-passcode");
    expect(startVoiceCapture).not.toHaveBeenCalled();
    expect(stopVoiceCapture).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
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
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(startVoiceCapture).not.toHaveBeenCalled();
  });
});

describe("normalizeJudgePasscode", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeJudgePasscode(" judge-passcode ")).toBe("judge-passcode");
  });
});
