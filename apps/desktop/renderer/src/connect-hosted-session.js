export function normalizeJudgePasscode(passcode) {
  return typeof passcode === "string" ? passcode.trim() : "";
}

export async function connectHostedSession({
  passcode,
  microphoneEnabled = true,
  startMuted = false,
  hideRuntimeError,
  showRuntimeError,
  stopPlayback,
  connect,
  setMuted,
  requestMicrophoneAccess,
  startVoiceCapture,
  stopVoiceCapture,
  disconnect
}) {
  const normalizedPasscode = normalizeJudgePasscode(passcode);
  if (!normalizedPasscode) {
    showRuntimeError(new Error("Enter the judge passcode to connect."));
    return false;
  }

  try {
    hideRuntimeError();
    await stopPlayback();
    await connect(normalizedPasscode);
    if (microphoneEnabled && typeof requestMicrophoneAccess === "function") {
      const microphoneAllowed = await requestMicrophoneAccess();
      if (!microphoneAllowed) {
        throw new Error("Microphone access is required to start the hosted session.");
      }
    }
    if (microphoneEnabled) {
      await startVoiceCapture();
    }
    if (typeof setMuted === "function") {
      await setMuted(microphoneEnabled ? Boolean(startMuted) : true);
    }
    return true;
  } catch (error) {
    showRuntimeError(error);
    await stopVoiceCapture().catch(() => undefined);
    await disconnect().catch(() => undefined);
    return false;
  }
}
