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
  let connected = false;
  if (!normalizedPasscode) {
    showRuntimeError(new Error("Enter the judge passcode to connect."));
    return false;
  }

  try {
    hideRuntimeError();
    await stopPlayback();
    if (microphoneEnabled && typeof requestMicrophoneAccess === "function") {
      const microphoneAllowed = await requestMicrophoneAccess();
      if (!microphoneAllowed) {
        throw new Error("Microphone access is required to start the hosted session.");
      }
    }
    await connect(normalizedPasscode);
    connected = true;
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
    if (connected) {
      await disconnect().catch(() => undefined);
    }
    return false;
  }
}
