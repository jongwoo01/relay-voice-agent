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
  let shouldUseMicrophone = Boolean(microphoneEnabled);
  let postConnectWarning = null;
  if (!normalizedPasscode) {
    showRuntimeError(new Error("Enter the judge passcode to connect."));
    return false;
  }

  try {
    hideRuntimeError();
    await stopPlayback();
    if (shouldUseMicrophone && typeof requestMicrophoneAccess === "function") {
      try {
        const microphoneAllowed = await requestMicrophoneAccess();
        if (!microphoneAllowed) {
          shouldUseMicrophone = false;
          postConnectWarning = new Error(
            "Hosted session started without microphone access. Grant microphone permission to use voice input."
          );
        }
      } catch (error) {
        shouldUseMicrophone = false;
        postConnectWarning =
          error instanceof Error
            ? error
            : new Error("Hosted session started without microphone access.");
      }
    }
    await connect(normalizedPasscode);
    connected = true;

    if (shouldUseMicrophone) {
      try {
        await startVoiceCapture();
      } catch (error) {
        shouldUseMicrophone = false;
        postConnectWarning =
          error instanceof Error
            ? error
            : new Error("Hosted session started without microphone access.");
        await stopVoiceCapture().catch(() => undefined);
      }
    }

    if (typeof setMuted === "function") {
      await setMuted(shouldUseMicrophone ? Boolean(startMuted) : true);
    }

    if (postConnectWarning) {
      showRuntimeError(postConnectWarning);
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
