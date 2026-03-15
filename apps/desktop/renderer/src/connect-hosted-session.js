export function normalizeJudgePasscode(passcode) {
  return typeof passcode === "string" ? passcode.trim() : "";
}

export async function connectHostedSession({
  passcode,
  hideRuntimeError,
  showRuntimeError,
  stopPlayback,
  connect,
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
    if (typeof requestMicrophoneAccess === "function") {
      const microphoneAllowed = await requestMicrophoneAccess();
      if (!microphoneAllowed) {
        throw new Error("Microphone access is required to start the hosted session.");
      }
    }
    await connect(normalizedPasscode);
    await startVoiceCapture();
    return true;
  } catch (error) {
    showRuntimeError(error);
    await stopVoiceCapture().catch(() => undefined);
    await disconnect().catch(() => undefined);
    return false;
  }
}
