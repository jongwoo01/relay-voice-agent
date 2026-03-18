function getErrorName(error) {
  return error instanceof Error && typeof error.name === "string"
    ? error.name
    : "";
}

function getErrorMessage(error) {
  return error instanceof Error && typeof error.message === "string"
    ? error.message
    : String(error ?? "");
}

export function isRetryableMicrophoneSelectionError(error) {
  const name = getErrorName(error);
  return name === "NotFoundError" || name === "OverconstrainedError";
}

export async function requestMicrophoneStream({
  mediaDevices,
  selectedMicId = "",
  audioConstraints = {}
}) {
  const preferredDeviceId =
    typeof selectedMicId === "string" ? selectedMicId.trim() : "";
  const baseAudioConstraints = {
    ...audioConstraints
  };

  if (preferredDeviceId) {
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          ...baseAudioConstraints,
          deviceId: { exact: preferredDeviceId }
        }
      });
      return {
        stream,
        usedFallbackDevice: false
      };
    } catch (error) {
      if (!isRetryableMicrophoneSelectionError(error)) {
        throw error;
      }
    }
  }

  const stream = await mediaDevices.getUserMedia({
    audio: baseAudioConstraints
  });
  return {
    stream,
    usedFallbackDevice: Boolean(preferredDeviceId)
  };
}

export function formatMicrophoneAccessError(
  error,
  { permissionStatus = "unknown", selectedMicId = "" } = {}
) {
  const name = getErrorName(error);
  const message = getErrorMessage(error);
  const hasSavedDevice = typeof selectedMicId === "string" && selectedMicId.trim().length > 0;

  if (name === "NotAllowedError" || name === "SecurityError") {
    if (permissionStatus === "denied" || permissionStatus === "restricted") {
      return new Error(
        "Relay does not currently have microphone access in macOS. Allow Relay in System Settings > Privacy & Security > Microphone, then reopen the app and retry."
      );
    }

    if (permissionStatus === "not-determined") {
      return new Error(
        "Relay has not completed microphone authorization yet. Request microphone access inside Relay first, accept the macOS prompt, then retry."
      );
    }

    return new Error(
      "macOS blocked microphone capture for Relay. Recheck the microphone permission state in Relay settings, then retry."
    );
  }

  if ((name === "NotFoundError" || name === "OverconstrainedError") && hasSavedDevice) {
    return new Error(
      "The previously selected microphone is no longer available. Relay reset the saved microphone selection. Choose an available input or retry with the default microphone."
    );
  }

  if (name === "NotReadableError" || name === "AbortError") {
    return new Error(
      "Relay could not open the microphone because the device is busy or unavailable. Close other apps using the mic, then retry."
    );
  }

  if (name === "TypeError" && message.includes("getUserMedia")) {
    return new Error(
      "This Relay build could not access the browser microphone APIs. Reopen the packaged app and retry from the signed desktop build."
    );
  }

  return error instanceof Error
    ? error
    : new Error(message || "Relay could not start microphone capture.");
}
