export const DESKTOP_DEBUG_FILTER_SOURCES = [
  "transport",
  "live",
  "bridge",
  "runtime",
  "executor"
];

export function createDefaultLiveVadSettings() {
  return {
    minSpeechThreshold: 0.045,
    confirmMs: 180,
    idleMs: 360,
    prerollChunks: 12,
    noiseFloor: 0.008,
    noiseAdaptation: 0.04,
    noiseGateMultiplier: 3.2,
    rmsSmoothing: 0.2,
    rmsBoost: 1.45,
    transientRmsRatio: 0.42
  };
}

export function createDefaultDesktopSettings() {
  return {
    audio: {
      defaultMicId: "",
      voiceCaptureEnabled: true,
      startMuted: false,
      liveVad: createDefaultLiveVadSettings()
    },
    executor: {
      enabled: true
    },
    ui: {
      motionPreference: "system",
      showHeaderHealthWarnings: true,
      autoOpenCompletedTasks: true
    },
    debug: {
      defaultFilters: Object.fromEntries(
        DESKTOP_DEBUG_FILTER_SOURCES.map((source) => [source, true])
      )
    }
  };
}

export function createDefaultSystemStatus() {
  return {
    microphonePermissionStatus: "unknown"
  };
}

function normalizeMotionPreference(value) {
  return value === "on" || value === "off" ? value : "system";
}

function normalizeBoundedNumber(value, fallback, { min, max }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeLiveVadSettings(input) {
  const defaults = createDefaultLiveVadSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  return {
    minSpeechThreshold: normalizeBoundedNumber(
      input.minSpeechThreshold,
      defaults.minSpeechThreshold,
      { min: 0.005, max: 0.2 }
    ),
    confirmMs: normalizeBoundedNumber(input.confirmMs, defaults.confirmMs, {
      min: 40,
      max: 1000
    }),
    idleMs: normalizeBoundedNumber(input.idleMs, defaults.idleMs, {
      min: 80,
      max: 2000
    }),
    prerollChunks: Math.round(
      normalizeBoundedNumber(input.prerollChunks, defaults.prerollChunks, {
        min: 1,
        max: 64
      })
    ),
    noiseFloor: normalizeBoundedNumber(input.noiseFloor, defaults.noiseFloor, {
      min: 0.001,
      max: 0.08
    }),
    noiseAdaptation: normalizeBoundedNumber(
      input.noiseAdaptation,
      defaults.noiseAdaptation,
      { min: 0.001, max: 0.5 }
    ),
    noiseGateMultiplier: normalizeBoundedNumber(
      input.noiseGateMultiplier,
      defaults.noiseGateMultiplier,
      { min: 1, max: 8 }
    ),
    rmsSmoothing: normalizeBoundedNumber(
      input.rmsSmoothing,
      defaults.rmsSmoothing,
      { min: 0.01, max: 0.95 }
    ),
    rmsBoost: normalizeBoundedNumber(input.rmsBoost, defaults.rmsBoost, {
      min: 1,
      max: 6
    }),
    transientRmsRatio: normalizeBoundedNumber(
      input.transientRmsRatio,
      defaults.transientRmsRatio,
      { min: 0.1, max: 1 }
    )
  };
}

function normalizeDebugFilters(filters) {
  const defaults = createDefaultDesktopSettings().debug.defaultFilters;
  const next = { ...defaults };

  if (!filters || typeof filters !== "object") {
    return next;
  }

  for (const source of DESKTOP_DEBUG_FILTER_SOURCES) {
    if (typeof filters[source] === "boolean") {
      next[source] = filters[source];
    }
  }

  return next;
}

export function normalizeDesktopSettings(input) {
  const defaults = createDefaultDesktopSettings();
  if (!input || typeof input !== "object") {
    return defaults;
  }

  return {
    audio: {
      defaultMicId:
        typeof input.audio?.defaultMicId === "string"
          ? input.audio.defaultMicId
          : defaults.audio.defaultMicId,
      voiceCaptureEnabled:
        typeof input.audio?.voiceCaptureEnabled === "boolean"
          ? input.audio.voiceCaptureEnabled
          : defaults.audio.voiceCaptureEnabled,
      startMuted:
        typeof input.audio?.startMuted === "boolean"
          ? input.audio.startMuted
          : defaults.audio.startMuted,
      liveVad: normalizeLiveVadSettings(input.audio?.liveVad)
    },
    executor: {
      enabled:
        typeof input.executor?.enabled === "boolean"
          ? input.executor.enabled
          : defaults.executor.enabled
    },
    ui: {
      motionPreference: normalizeMotionPreference(input.ui?.motionPreference),
      showHeaderHealthWarnings:
        typeof input.ui?.showHeaderHealthWarnings === "boolean"
          ? input.ui.showHeaderHealthWarnings
          : defaults.ui.showHeaderHealthWarnings,
      autoOpenCompletedTasks:
        typeof input.ui?.autoOpenCompletedTasks === "boolean"
          ? input.ui.autoOpenCompletedTasks
          : defaults.ui.autoOpenCompletedTasks
    },
    debug: {
      defaultFilters: normalizeDebugFilters(input.debug?.defaultFilters)
    }
  };
}

export function mergeDesktopSettings(current, patch) {
  if (!patch || typeof patch !== "object") {
    return normalizeDesktopSettings(current);
  }

  return normalizeDesktopSettings({
    ...normalizeDesktopSettings(current),
    ...patch,
    audio: {
      ...normalizeDesktopSettings(current).audio,
      ...(patch.audio ?? {})
    },
    executor: {
      ...normalizeDesktopSettings(current).executor,
      ...(patch.executor ?? {})
    },
    ui: {
      ...normalizeDesktopSettings(current).ui,
      ...(patch.ui ?? {})
    },
    debug: {
      ...normalizeDesktopSettings(current).debug,
      ...(patch.debug ?? {}),
      defaultFilters: {
        ...normalizeDesktopSettings(current).debug.defaultFilters,
        ...(patch.debug?.defaultFilters ?? {})
      }
    }
  });
}

export function normalizeMicrophonePermissionStatus(value) {
  return value === "granted" ||
    value === "denied" ||
    value === "restricted" ||
    value === "not-determined"
    ? value
    : "unknown";
}
