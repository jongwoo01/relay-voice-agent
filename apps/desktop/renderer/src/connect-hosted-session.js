export function normalizeJudgePasscode(passcode) {
  return typeof passcode === "string" ? passcode.trim() : "";
}

export async function connectHostedSession({
  passcode,
  hideRuntimeError,
  showRuntimeError,
  stopPlayback,
  connect,
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
    await startVoiceCapture();
    return true;
  } catch (error) {
    showRuntimeError(error);
    await stopVoiceCapture().catch(() => undefined);
    await disconnect().catch(() => undefined);
    return false;
  }
}
