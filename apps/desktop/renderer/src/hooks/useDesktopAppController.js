import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useMotionValue } from "motion/react";
import { connectHostedSession } from "../connect-hosted-session.js";
import liveInputMeterWorkletUrl from "../audio/live-input-meter.worklet.js?url";
import {
  classifyLiveSpeechCandidate,
  SPEECH_CANDIDATE_DIP_TOLERANCE_MS
} from "../live-vad.js";
import { createDefaultDesktopSettings } from "../../../src/main/ui/desktop-settings.js";
import {
  buildDisplayConversationTimeline,
  buildArchivedTaskEntries,
  buildHistoryEntries,
  buildTaskRunnerEntries,
  filterDebugEvents,
  resolveTaskPanelSelection,
  TASK_CANCEL_CONFIRMATION_DWELL_MS
} from "../ui-utils.js";
import {
  formatMicrophoneAccessError,
  requestMicrophoneStream
} from "../microphone-access.js";

const LIVE_INPUT_BUFFER_SIZE = 512;
const LIVE_INPUT_WORKLET_NAME = "relay-live-input-meter";
const LIVE_INPUT_DEBUG_ENABLED = import.meta.env.VITE_LIVE_INPUT_DEBUG === "1";
export const DEBUG_FILTER_DEFAULTS = {
  transport: true,
  live: true,
  bridge: true,
  runtime: true,
  executor: true
};

const EMPTY_UI_STATE = {
  brainSessionId: null,
  executionMode: "unknown",
  executorHealth: {
    status: "unknown",
    code: null,
    summary: "Gemini CLI health has not been checked yet.",
    detail: "Relay can run a lightweight Gemini CLI probe and show the result here.",
    checkedAt: null,
    canRunLocalTasks: false,
    commandPath: null,
    authStrategy: "unknown",
    exitCode: null,
    probeWorkingDirectory: null,
    stdoutSnippet: null,
    stderrSnippet: null
  },
  conversationTimeline: [],
  conversationTurns: [],
  activeTurnId: null,
  rawInputPartial: "",
  inputPartial: "",
  lastUserTranscript: "",
  outputTranscript: "",
  debugInspector: { events: [], availableSources: Object.keys(DEBUG_FILTER_DEFAULTS) },
  taskSummary: {
    activeTasks: [],
    recentTasks: [],
    taskTimelines: [],
    taskRunnerDetails: [],
    intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
    avatar: { mainState: "idle", taskRunners: [] },
    notifications: { pending: [], delivered: [] },
    pendingBriefingCount: 0
  },
  settings: createDefaultDesktopSettings(),
  systemStatus: {
    microphonePermissionStatus: "unknown"
  },
  historySummary: { loading: false, error: null, sessions: [] },
  voiceControlState: {
    connected: false,
    connecting: false,
    status: "idle",
    muted: false,
    error: null,
    activityDetection: { mode: "auto", source: "server" },
    routing: { mode: "idle", summary: "", detail: "" },
    mic: { mode: "idle", enabled: false },
    activity: { userSpeaking: false, assistantSpeaking: false }
  },
  inputState: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
  runtimeError: null
};

const EMPTY_SETUP_STATUS = {
  checkedAt: null,
  hostedBackend: {
    status: "unknown",
    summary: "Hosted backend has not been checked yet.",
    detail: "Relay will probe the backend when setup status is refreshed."
  },
  microphone: {
    status: "unknown",
    summary: "Microphone access has not been checked yet.",
    detail: "Grant microphone access before starting a live voice session."
  },
  localExecutorBinary: {
    status: "unknown",
    summary: "Gemini CLI binary has not been checked yet.",
    detail: "Relay will probe the local Gemini CLI binary when setup status is refreshed."
  },
  localFileAccess: {
    status: "unknown",
    summary: "Local file access has not been checked yet.",
    detail: "Relay will probe common local folders when setup status is refreshed.",
    directories: []
  }
};

function sameBooleanMap(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  for (const key of keys) {
    if (Boolean(left?.[key]) !== Boolean(right?.[key])) {
      return false;
    }
  }

  return true;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function base64ToFloat32AudioData(base64String) {
  const byteCharacters = atob(base64String);
  const byteArray = new Uint8Array(byteCharacters.length);

  for (let index = 0; index < byteCharacters.length; index += 1) {
    byteArray[index] = byteCharacters.charCodeAt(index);
  }

  const samples = new Float32Array(byteArray.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    let sample = byteArray[index * 2] | (byteArray[index * 2 + 1] << 8);
    if (sample >= 32768) {
      sample -= 65536;
    }
    samples[index] = sample / 32768;
  }

  return samples;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function avatarStateForUi(summary, voiceState, inputState) {
  if (voiceState.activity?.assistantSpeaking) {
    return "speaking";
  }

  if (inputState.inFlight) {
    return "thinking";
  }

  if (
    voiceState.status === "thinking" ||
    voiceState.status === "responding" ||
    voiceState.status === "finishing"
  ) {
    return "thinking";
  }

  if (voiceState.activity?.userSpeaking || voiceState.status === "listening") {
    return "listening";
  }

  if (voiceState.status === "interrupted") {
    return "interrupted";
  }

  if (summary.avatar?.mainState === "waiting_user") {
    return "waiting_user";
  }

  if (summary.avatar?.mainState === "briefing") {
    return "briefing";
  }

  if (
    summary.avatar?.mainState === "thinking" ||
    summary.avatar?.mainState === "reflecting"
  ) {
    return "thinking";
  }

  return "idle";
}

export function useDesktopAppController() {
  const [uiState, setUiState] = useState(EMPTY_UI_STATE);
  const deferredUiState = useDeferredValue(uiState);
  const [runtimeError, setRuntimeError] = useState(null);
  const [systemPrefersReducedMotion, setSystemPrefersReducedMotion] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [taskSelectionDismissed, setTaskSelectionDismissed] = useState(false);
  const [taskCancelUiState, setTaskCancelUiState] = useState({});
  const [prompt, setPrompt] = useState("");
  const [promptComposing, setPromptComposing] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [microphones, setMicrophones] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [setupStatus, setSetupStatus] = useState(EMPTY_SETUP_STATUS);
  const [setupStatusLoading, setSetupStatusLoading] = useState(false);
  const [debugFilters, setDebugFilters] = useState(DEBUG_FILTER_DEFAULTS);
  const [debugTurnFilter, setDebugTurnFilter] = useState("");
  const [debugTaskFilter, setDebugTaskFilter] = useState("");
  const mouthOpen = useMotionValue(0);
  const audioEnergy = useMotionValue(0);
  const inputEnergy = useMotionValue(0);

  const uiStateRef = useRef(uiState);
  const selectedTaskIdRef = useRef(selectedTaskId);
  const taskCancelTimeoutsRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserDataRef = useRef(null);
  const faceAnimationRef = useRef(null);
  const audioQueueRef = useRef([]);
  const audioQueueProcessingRef = useRef(false);
  const audioNextStartTimeRef = useRef(0);
  const audioIgnoreUntilRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const recorderContextRef = useRef(null);
  const recorderSourceRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const recorderWorkletNodeRef = useRef(null);
  const recorderFallbackNodeRef = useRef(null);
  const recorderGainNodeRef = useRef(null);
  const recorderStartPromiseRef = useRef(null);
  const userSpeakingTimerRef = useRef(null);
  const userSpeakingActiveRef = useRef(false);
  const speechCandidateStartAtRef = useRef(0);
  const speechCandidateBelowThresholdAtRef = useRef(0);
  const liveActivityActiveRef = useRef(false);
  const liveActivitySequenceRef = useRef(0);
  const liveAudioChunkCountRef = useRef(0);
  const pendingSpeechChunksRef = useRef([]);
  const pendingExecutorHealthRefreshRef = useRef(false);
  const liveVadConfigRef = useRef(createDefaultDesktopSettings().audio.liveVad);
  const liveVadStateRef = useRef({
    noiseFloor: createDefaultDesktopSettings().audio.liveVad.noiseFloor,
    smoothedRms: 0
  });

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    if (!window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setSystemPrefersReducedMotion(mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener?.("change", update);

    return () => {
      mediaQuery.removeEventListener?.("change", update);
    };
  }, []);

  const voiceState = deferredUiState.voiceControlState ?? EMPTY_UI_STATE.voiceControlState;
  const executorHealth = deferredUiState.executorHealth ?? EMPTY_UI_STATE.executorHealth;
  const summary = deferredUiState.taskSummary ?? EMPTY_UI_STATE.taskSummary;
  const settings = deferredUiState.settings ?? EMPTY_UI_STATE.settings;
  const systemStatus = deferredUiState.systemStatus ?? EMPTY_UI_STATE.systemStatus;
  const historySummary = deferredUiState.historySummary ?? EMPTY_UI_STATE.historySummary;
  const inputState = deferredUiState.inputState ?? EMPTY_UI_STATE.inputState;
  const debugInspector = deferredUiState.debugInspector ?? EMPTY_UI_STATE.debugInspector;
  const liveVadConfig = settings.audio.liveVad ?? EMPTY_UI_STATE.settings.audio.liveVad;
  const prefersReducedMotion =
    settings.ui.motionPreference === "system"
      ? systemPrefersReducedMotion
      : settings.ui.motionPreference === "on";

  const voiceStateRef = useRef(voiceState);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    setDebugFilters((current) =>
      sameBooleanMap(current, settings.debug.defaultFilters)
        ? current
        : settings.debug.defaultFilters
    );
  }, [settings.debug.defaultFilters]);

  useEffect(() => {
    liveVadConfigRef.current = liveVadConfig;
    liveVadStateRef.current = {
      noiseFloor: clamp(
        liveVadStateRef.current.noiseFloor || liveVadConfig.noiseFloor,
        liveVadConfig.noiseFloor * 0.5,
        liveVadConfig.minSpeechThreshold
      ),
      smoothedRms: liveVadStateRef.current.smoothedRms || 0
    };
  }, [liveVadConfig]);

  useEffect(() => {
    const preferredDeviceId = settings.audio.defaultMicId?.trim() ?? "";
    if (preferredDeviceId && microphones.some((device) => device.deviceId === preferredDeviceId)) {
      setSelectedMicId((current) => (current === preferredDeviceId ? current : preferredDeviceId));
      return;
    }

    if (!selectedMicId && microphones[0]?.deviceId) {
      setSelectedMicId(microphones[0].deviceId);
    }
  }, [microphones, selectedMicId, settings.audio.defaultMicId]);

  const showRuntimeError = useCallback((error) => {
    setRuntimeError(error instanceof Error ? error.message : String(error));
  }, []);

  const hideRuntimeError = useCallback(() => {
    setRuntimeError(null);
  }, []);

  const refreshSetupStatus = useCallback(
    async (options = {}) => {
      if (!window.desktopUi?.getSetupStatus) {
        return EMPTY_SETUP_STATUS;
      }

      setSetupStatusLoading(true);
      try {
        const nextStatus = await window.desktopUi.getSetupStatus(options);
        setSetupStatus(nextStatus ?? EMPTY_SETUP_STATUS);
        return nextStatus ?? EMPTY_SETUP_STATUS;
      } catch (error) {
        showRuntimeError(error);
        return EMPTY_SETUP_STATUS;
      } finally {
        setSetupStatusLoading(false);
      }
    },
    [showRuntimeError]
  );

  const runExecutorHealthRefresh = useCallback(async () => {
    try {
      hideRuntimeError();
      await window.desktopUi.retryExecutorHealthCheck();
      await refreshSetupStatus({ refresh: false });
      return true;
    } catch (error) {
      showRuntimeError(error);
      return false;
    }
  }, [hideRuntimeError, refreshSetupStatus, showRuntimeError]);

  const updateDesktopSettings = useCallback(
    async (patch) => {
      const nextSettings = await window.desktopUi.updateSettings(patch);
      startTransition(() => {
        setUiState((current) => ({
          ...current,
          settings: nextSettings
        }));
      });
      return nextSettings;
    },
    []
  );

  const setRuntimeUserSpeaking = useCallback(async (speaking) => {
    if (voiceStateRef.current.activity?.userSpeaking === speaking) {
      return;
    }

    await window.desktopSession.setUserSpeaking(speaking);
  }, []);

  const setRuntimeAssistantSpeaking = useCallback(async (speaking) => {
    if (voiceStateRef.current.activity?.assistantSpeaking === speaking) {
      return;
    }

    await window.desktopSession.setAssistantSpeaking(speaking);
  }, []);

  const startAvatarMouthSync = useCallback(() => {
    if (faceAnimationRef.current) {
      cancelAnimationFrame(faceAnimationRef.current);
    }

    const updateMouth = () => {
      faceAnimationRef.current = requestAnimationFrame(updateMouth);
      const analyser = analyserRef.current;
      const analyserData = analyserDataRef.current;

      if (!analyser || !analyserData) {
        return;
      }

      if (!voiceStateRef.current.activity?.assistantSpeaking) {
        mouthOpen.set(0);
        audioEnergy.set(0);
        return;
      }

      analyser.getByteFrequencyData(analyserData);
      let sum = 0;
      for (let index = 0; index < analyserData.length; index += 1) {
        sum += analyserData[index];
      }

      const normalized = Math.min(1, (sum / analyserData.length) / 180);
      mouthOpen.set(normalized);
      audioEnergy.set(normalized);
    };

    updateMouth();
  }, [audioEnergy, mouthOpen]);

  const ensurePlaybackContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
      audioNextStartTimeRef.current = audioContextRef.current.currentTime;
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 64;
      analyserDataRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.connect(audioContextRef.current.destination);
      startAvatarMouthSync();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  }, [startAvatarMouthSync]);

  const stopPlayback = useCallback(async () => {
    audioQueueRef.current = [];
    activeSourcesRef.current.splice(0).forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // noop
      }
    });
    audioNextStartTimeRef.current = 0;
    audioQueueProcessingRef.current = false;
    audioIgnoreUntilRef.current = Date.now() + 250;
    mouthOpen.set(0);
    audioEnergy.set(0);
    await setRuntimeAssistantSpeaking(false).catch(() => undefined);
  }, [audioEnergy, mouthOpen, setRuntimeAssistantSpeaking]);

  const playQueuedAudio = useCallback(async () => {
    if (audioQueueProcessingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    audioQueueProcessingRef.current = true;

    try {
      await ensurePlaybackContext();
      await setRuntimeAssistantSpeaking(true);

      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();
        const context = audioContextRef.current;
        const analyser = analyserRef.current;
        const audioBuffer = context.createBuffer(1, chunk.length, 24000);
        audioBuffer.copyToChannel(chunk, 0);

        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        activeSourcesRef.current.push(source);
        source.onended = () => {
          const index = activeSourcesRef.current.indexOf(source);
          if (index >= 0) {
            activeSourcesRef.current.splice(index, 1);
          }
        };

        if (audioNextStartTimeRef.current < context.currentTime) {
          audioNextStartTimeRef.current = context.currentTime;
        }

        source.start(audioNextStartTimeRef.current);
        audioNextStartTimeRef.current += audioBuffer.duration;
      }

      const waitMs = Math.max(
        0,
        (audioNextStartTimeRef.current - audioContextRef.current.currentTime) * 1000
      );
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      audioQueueProcessingRef.current = false;
      if (audioQueueRef.current.length > 0) {
        void playQueuedAudio();
        return;
      }

      mouthOpen.set(0);
      audioEnergy.set(0);
      await setRuntimeAssistantSpeaking(false);
    }
  }, [audioEnergy, ensurePlaybackContext, mouthOpen, setRuntimeAssistantSpeaking]);

  const usesManualServerActivityDetection = useCallback(
    () => voiceStateRef.current.activityDetection?.mode === "manual",
    []
  );

  const handleAudioChunk = useCallback(
    async (chunk) => {
      const usingManualServerActivityDetection = usesManualServerActivityDetection();
      if (
        (usingManualServerActivityDetection && userSpeakingActiveRef.current) ||
        Date.now() < audioIgnoreUntilRef.current ||
        voiceStateRef.current.status === "interrupted"
      ) {
        return;
      }

      audioQueueRef.current.push(base64ToFloat32AudioData(chunk.data));
      await playQueuedAudio();
    },
    [playQueuedAudio, usesManualServerActivityDetection]
  );

  const startLiveActivity = useCallback(() => {
    if (liveActivityActiveRef.current) {
      return;
    }

    liveActivityActiveRef.current = true;
    liveActivitySequenceRef.current += 1;
    liveAudioChunkCountRef.current = 0;
    if (LIVE_INPUT_DEBUG_ENABLED) {
      console.info("[live-input][renderer] activity_start", {
        seq: liveActivitySequenceRef.current,
        mode: usesManualServerActivityDetection() ? "manual" : "auto",
        preroll: pendingSpeechChunksRef.current.length
      });
    }
    if (usesManualServerActivityDetection()) {
      window.desktopLive?.startActivity?.();
      for (const chunk of pendingSpeechChunksRef.current) {
        window.desktopLive?.sendAudioChunk?.(chunk, "audio/pcm;rate=16000");
        liveAudioChunkCountRef.current += 1;
      }
    }
    pendingSpeechChunksRef.current = [];
  }, [usesManualServerActivityDetection]);

  const endLiveActivity = useCallback(() => {
    if (!liveActivityActiveRef.current) {
      return;
    }

    if (LIVE_INPUT_DEBUG_ENABLED) {
      console.info("[live-input][renderer] activity_end", {
        seq: liveActivitySequenceRef.current,
        chunks: liveAudioChunkCountRef.current
      });
    }
    liveActivityActiveRef.current = false;
    if (usesManualServerActivityDetection()) {
      window.desktopLive?.endActivity?.();
    }
  }, [usesManualServerActivityDetection]);

  const scheduleUserSpeakingReset = useCallback(() => {
    clearTimeout(userSpeakingTimerRef.current);
    userSpeakingTimerRef.current = setTimeout(() => {
      userSpeakingActiveRef.current = false;
      speechCandidateStartAtRef.current = 0;
      speechCandidateBelowThresholdAtRef.current = 0;
      inputEnergy.set(0);
      endLiveActivity();
      void setRuntimeUserSpeaking(false).catch(showRuntimeError);
    }, liveVadConfigRef.current.idleMs);
  }, [endLiveActivity, inputEnergy, setRuntimeUserSpeaking, showRuntimeError]);

  const handleLiveUserAudioActivity = useCallback(
    ({ activityLevel, threshold, rms }) => {
      const now = Date.now();
      const assistantSpeaking = voiceStateRef.current.activity?.assistantSpeaking === true;
      const speechCandidate = classifyLiveSpeechCandidate({
        activityLevel,
        rms,
        threshold,
        config: liveVadConfigRef.current,
        assistantSpeaking
      });

      if (!speechCandidate.accepted) {
        if (speechCandidateStartAtRef.current) {
          if (!speechCandidateBelowThresholdAtRef.current) {
            speechCandidateBelowThresholdAtRef.current = now;
          }

          if (
            now - speechCandidateBelowThresholdAtRef.current >=
            SPEECH_CANDIDATE_DIP_TOLERANCE_MS
          ) {
            speechCandidateStartAtRef.current = 0;
            speechCandidateBelowThresholdAtRef.current = 0;
          }
        }
        return;
      }

      speechCandidateBelowThresholdAtRef.current = 0;
      if (!speechCandidateStartAtRef.current) {
        speechCandidateStartAtRef.current = now;
      }

      if (now - speechCandidateStartAtRef.current < speechCandidate.confirmMs) {
        return;
      }

      if (!userSpeakingActiveRef.current) {
        if (assistantSpeaking) {
          void stopPlayback();
        }
        userSpeakingActiveRef.current = true;
        startLiveActivity();
        void setRuntimeUserSpeaking(true).catch(showRuntimeError);
      }

      scheduleUserSpeakingReset();
    },
    [scheduleUserSpeakingReset, setRuntimeUserSpeaking, showRuntimeError, startLiveActivity, stopPlayback]
  );

  const handleLiveInputFrame = useCallback(
    ({ pcm16, peak, rms }) => {
      const manualServerActivityDetection = usesManualServerActivityDetection();
      const config = liveVadConfigRef.current;
      const previousState = liveVadStateRef.current;
      const smoothedRms =
        previousState.smoothedRms +
        (rms - previousState.smoothedRms) * config.rmsSmoothing;
      let noiseFloor = previousState.noiseFloor || config.noiseFloor;

      if (!liveActivityActiveRef.current && !userSpeakingActiveRef.current) {
        const clampedNoiseSample = Math.min(smoothedRms, config.minSpeechThreshold);
        noiseFloor =
          noiseFloor + (clampedNoiseSample - noiseFloor) * config.noiseAdaptation;
        noiseFloor = clamp(
          noiseFloor,
          config.noiseFloor * 0.5,
          config.minSpeechThreshold
        );
      }

      const threshold = Math.max(
        config.minSpeechThreshold,
        noiseFloor * config.noiseGateMultiplier
      );
      const boostedRms = smoothedRms * config.rmsBoost;
      const activityLevel = Math.max(peak, boostedRms);
      const looksLikeTransientNoise =
        peak >= threshold && smoothedRms < threshold * config.transientRmsRatio;

      liveVadStateRef.current = {
        noiseFloor,
        smoothedRms
      };

      inputEnergy.set(Math.min(1, activityLevel / Math.max(threshold * 3, 0.18)));
      handleLiveUserAudioActivity({
        activityLevel: looksLikeTransientNoise ? 0 : activityLevel,
        threshold,
        rms: looksLikeTransientNoise ? 0 : smoothedRms
      });

      const encodedChunk = arrayBufferToBase64(pcm16.buffer);
      if (manualServerActivityDetection && !liveActivityActiveRef.current) {
        pendingSpeechChunksRef.current.push(encodedChunk);
        if (pendingSpeechChunksRef.current.length > config.prerollChunks) {
          pendingSpeechChunksRef.current.shift();
        }
        if (LIVE_INPUT_DEBUG_ENABLED && pendingSpeechChunksRef.current.length === 1) {
          console.info("[live-input][renderer] buffer_preroll", {
            seq: liveActivitySequenceRef.current + 1,
            peak: Number(peak.toFixed(4)),
            rms: Number(rms.toFixed(4)),
            threshold: Number(threshold.toFixed(4)),
            transientRejected: looksLikeTransientNoise
          });
        }
        return;
      }

      liveAudioChunkCountRef.current += 1;
      if (
        LIVE_INPUT_DEBUG_ENABLED &&
        (liveAudioChunkCountRef.current <= 3 ||
          liveAudioChunkCountRef.current % 20 === 0)
      ) {
        console.info("[live-input][renderer] audio_chunk", {
          seq: liveActivitySequenceRef.current,
          chunk: liveAudioChunkCountRef.current,
          samples: pcm16.length,
          peak: Number(peak.toFixed(4)),
          rms: Number(rms.toFixed(4)),
          threshold: Number(threshold.toFixed(4)),
          transientRejected: looksLikeTransientNoise,
          activityActive: liveActivityActiveRef.current
        });
      }
      window.desktopLive.sendAudioChunk(encodedChunk, "audio/pcm;rate=16000");
    },
    [handleLiveUserAudioActivity, inputEnergy, usesManualServerActivityDetection]
  );

  const populateMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput");
    setMicrophones(inputs);
    setSelectedMicId((current) => {
      if (current && inputs.some((device) => device.deviceId === current)) {
        return current;
      }

      const preferredDeviceId = uiStateRef.current.settings?.audio?.defaultMicId?.trim() ?? "";
      if (preferredDeviceId && inputs.some((device) => device.deviceId === preferredDeviceId)) {
        return preferredDeviceId;
      }

      return inputs[0]?.deviceId || "";
    });
  }, []);

  const clearSavedMicrophoneSelection = useCallback(async () => {
    setSelectedMicId("");
    await window.desktopUi?.updateSettings?.({
      audio: {
        defaultMicId: ""
      }
    });
  }, []);

  const stopVoiceCapture = useCallback(async () => {
    recorderStartPromiseRef.current = null;
    clearTimeout(userSpeakingTimerRef.current);
    userSpeakingActiveRef.current = false;
    speechCandidateStartAtRef.current = 0;
    speechCandidateBelowThresholdAtRef.current = 0;
    pendingSpeechChunksRef.current = [];
    liveVadStateRef.current = {
      noiseFloor: liveVadConfigRef.current.noiseFloor,
      smoothedRms: 0
    };
    endLiveActivity();
    inputEnergy.set(0);
    recorderWorkletNodeRef.current?.disconnect();
    recorderFallbackNodeRef.current?.disconnect();
    recorderGainNodeRef.current?.disconnect();
    recorderSourceRef.current?.disconnect();
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderWorkletNodeRef.current = null;
    recorderFallbackNodeRef.current = null;
    recorderGainNodeRef.current = null;
    recorderSourceRef.current = null;
    recorderStreamRef.current = null;

    if (recorderContextRef.current && recorderContextRef.current.state !== "closed") {
      await recorderContextRef.current.close();
    }

    recorderContextRef.current = null;
    await setRuntimeUserSpeaking(false).catch(() => undefined);
  }, [endLiveActivity, inputEnergy, setRuntimeUserSpeaking]);

  const startVoiceCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not available in this environment.");
    }

    if (recorderStreamRef.current) {
      return;
    }

    if (recorderStartPromiseRef.current) {
      return recorderStartPromiseRef.current;
    }

    recorderStartPromiseRef.current = (async () => {
      pendingSpeechChunksRef.current = [];

      const audioConstraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };
      try {
        const { stream, usedFallbackDevice } = await requestMicrophoneStream({
          mediaDevices: navigator.mediaDevices,
          selectedMicId,
          audioConstraints
        });
        recorderStreamRef.current = stream;
        if (usedFallbackDevice) {
          console.warn(
            "[live-input][renderer] saved microphone unavailable, falling back to default input"
          );
          await clearSavedMicrophoneSelection().catch(() => undefined);
        }
      } catch (error) {
        throw formatMicrophoneAccessError(error, {
          permissionStatus: uiStateRef.current.systemStatus?.microphonePermissionStatus,
          selectedMicId
        });
      }

      await populateMicrophones();

      recorderContextRef.current = new AudioContext({
        sampleRate: 16000,
        latencyHint: "interactive"
      });
      if (recorderContextRef.current.state === "suspended") {
        await recorderContextRef.current.resume();
      }

      recorderSourceRef.current =
        recorderContextRef.current.createMediaStreamSource(recorderStreamRef.current);
      recorderGainNodeRef.current = recorderContextRef.current.createGain();
      recorderGainNodeRef.current.gain.value = 0;
      speechCandidateBelowThresholdAtRef.current = 0;
      liveVadStateRef.current = {
        noiseFloor: liveVadConfigRef.current.noiseFloor,
        smoothedRms: 0
      };

      const audioWorkletSupported =
        typeof AudioWorkletNode !== "undefined" &&
        recorderContextRef.current.audioWorklet &&
        typeof recorderContextRef.current.audioWorklet.addModule === "function";

      if (audioWorkletSupported) {
        try {
          await recorderContextRef.current.audioWorklet.addModule(
            liveInputMeterWorkletUrl
          );
          recorderWorkletNodeRef.current = new AudioWorkletNode(
            recorderContextRef.current,
            LIVE_INPUT_WORKLET_NAME,
            {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1]
            }
          );
          recorderWorkletNodeRef.current.port.onmessage = (event) => {
            const pcm16 =
              event.data?.pcm16 instanceof Int16Array
                ? event.data.pcm16
                : new Int16Array(event.data?.pcm16 ?? []);
            if (pcm16.length === 0) {
              return;
            }

            handleLiveInputFrame({
              pcm16,
              peak: Number(event.data?.peak ?? 0),
              rms: Number(event.data?.rms ?? 0)
            });
          };
          recorderSourceRef.current.connect(recorderWorkletNodeRef.current);
          recorderWorkletNodeRef.current.connect(recorderGainNodeRef.current);
        } catch (error) {
          if (LIVE_INPUT_DEBUG_ENABLED) {
            console.warn("[live-input][renderer] falling back to ScriptProcessorNode", error);
          }
          recorderWorkletNodeRef.current?.disconnect();
          recorderWorkletNodeRef.current = null;
        }
      }

      if (!recorderWorkletNodeRef.current) {
        recorderFallbackNodeRef.current = recorderContextRef.current.createScriptProcessor(
          LIVE_INPUT_BUFFER_SIZE,
          1,
          1
        );
        recorderFallbackNodeRef.current.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          let peak = 0;
          let sumSquares = 0;
          const pcm16 = new Int16Array(inputData.length);

          for (let index = 0; index < inputData.length; index += 1) {
            const value = Math.max(-1, Math.min(1, inputData[index]));
            peak = Math.max(peak, Math.abs(value));
            sumSquares += value * value;
            pcm16[index] = value * 32768;
          }

          handleLiveInputFrame({
            pcm16,
            peak,
            rms: Math.sqrt(sumSquares / inputData.length)
          });
        };
        recorderSourceRef.current.connect(recorderFallbackNodeRef.current);
        recorderFallbackNodeRef.current.connect(recorderGainNodeRef.current);
      }

      recorderGainNodeRef.current.connect(recorderContextRef.current.destination);
    })();

    try {
      await recorderStartPromiseRef.current;
    } finally {
      recorderStartPromiseRef.current = null;
    }
  }, [
    clearSavedMicrophoneSelection,
    handleLiveInputFrame,
    populateMicrophones,
    selectedMicId
  ]);

  const primeMicrophoneCaptureAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not available in this environment.");
    }

    let stream;
    try {
      const result = await requestMicrophoneStream({
        mediaDevices: navigator.mediaDevices,
        selectedMicId,
        audioConstraints: {
          channelCount: 1
        }
      });
      stream = result.stream;
      if (result.usedFallbackDevice) {
        console.warn(
          "[live-input][renderer] permission warmup used the default microphone because the saved input was unavailable"
        );
        await clearSavedMicrophoneSelection().catch(() => undefined);
      }
      await populateMicrophones();
      return true;
    } catch (error) {
      throw formatMicrophoneAccessError(error, {
        permissionStatus: uiStateRef.current.systemStatus?.microphonePermissionStatus,
        selectedMicId
      });
    } finally {
      stream?.getTracks?.().forEach((track) => track.stop());
    }
  }, [clearSavedMicrophoneSelection, populateMicrophones, selectedMicId]);

  const requestMicrophoneAccessWithCapture = useCallback(async () => {
    try {
      const granted = await (window.desktopSystem?.requestMicrophoneAccess?.() ?? false);
      if (!granted) {
        return false;
      }

      await primeMicrophoneCaptureAccess();
      return true;
    } finally {
      await refreshSetupStatus({ refresh: false });
    }
  }, [primeMicrophoneCaptureAccess, refreshSetupStatus]);

  const ensureVoiceCaptureReady = useCallback(
    async ({ enableIfDisabled = false } = {}) => {
      const currentSettings = uiStateRef.current.settings ?? createDefaultDesktopSettings();
      if (currentSettings.audio?.voiceCaptureEnabled === false) {
        if (!enableIfDisabled) {
          return false;
        }

        await updateDesktopSettings({
          audio: {
            voiceCaptureEnabled: true
          }
        });
      }

      let granted =
        uiStateRef.current.systemStatus?.microphonePermissionStatus === "granted";
      if (!granted) {
        granted = await requestMicrophoneAccessWithCapture();
        if (!granted) {
          return false;
        }
      }

      if (!recorderStreamRef.current) {
        await startVoiceCapture();
      }

      return true;
    },
    [requestMicrophoneAccessWithCapture, startVoiceCapture, updateDesktopSettings]
  );

  useEffect(() => {
    let unsubscribeState = () => {};
    let unsubscribeAudio = () => {};
    let cancelled = false;

    async function bootstrap() {
      if (!window.desktopUi || typeof window.desktopUi.init !== "function") {
        throw new Error("desktopUi bridge is not available. Check preload setup.");
      }

      const state = await window.desktopUi.init();
      if (cancelled) {
        return;
      }

      hideRuntimeError();
      startTransition(() => {
        setUiState(state);
      });

      unsubscribeState = window.desktopUi.onStateUpdated((nextState) => {
        if (
          nextState?.voiceControlState?.status === "interrupted" &&
          voiceStateRef.current.status !== "interrupted"
        ) {
          void stopPlayback();
        }
        startTransition(() => {
          setUiState(nextState);
        });
      });

      unsubscribeAudio = window.desktopLive.onAudioChunk((chunk) => {
        void handleAudioChunk(chunk);
      });

      await populateMicrophones();
      await refreshSetupStatus({ refresh: false });
    }

    bootstrap().catch(showRuntimeError);

    const onDeviceChange = () => {
      void populateMicrophones().catch(showRuntimeError);
    };
    const onWindowFocus = () => {
      if (!pendingExecutorHealthRefreshRef.current) {
        return;
      }

      pendingExecutorHealthRefreshRef.current = false;
      void runExecutorHealthRefresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      onWindowFocus();
    };
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        setDebugOpen((current) => !current);
      }
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeAudio();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      if (faceAnimationRef.current) {
        cancelAnimationFrame(faceAnimationRef.current);
      }
      void stopPlayback();
      void stopVoiceCapture();
    };
  }, [
    handleAudioChunk,
    hideRuntimeError,
    populateMicrophones,
    refreshSetupStatus,
    runExecutorHealthRefresh,
    showRuntimeError,
    stopPlayback,
    stopVoiceCapture
  ]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    void refreshSetupStatus({ refresh: true });
  }, [refreshSetupStatus, settingsOpen]);

  useEffect(() => {
    const shouldStop = voiceState.status === "interrupted" || !voiceState.connected;
    if (shouldStop) {
      void stopPlayback();
    }
  }, [stopPlayback, voiceState.connected, voiceState.status]);

  const taskRunners = useMemo(() => buildTaskRunnerEntries(summary), [summary]);
  const archivedEntries = useMemo(() => buildArchivedTaskEntries(summary), [summary]);

  const previousTaskPanelRef = useRef({
    taskRunners: [],
    archivedEntries: []
  });

  useEffect(() => {
    const previousTaskPanel = previousTaskPanelRef.current;
    const resolution = resolveTaskPanelSelection({
      selectedTaskId,
      selectionDismissed: taskSelectionDismissed,
      taskRunners,
      archivedEntries,
      previousTaskRunners: previousTaskPanel.taskRunners,
      previousArchivedEntries: previousTaskPanel.archivedEntries
    });

    previousTaskPanelRef.current = {
      taskRunners,
      archivedEntries
    };

    if (resolution.nextSelectedTaskId !== selectedTaskId) {
      setSelectedTaskId(resolution.nextSelectedTaskId);
      if (resolution.nextSelectedTaskId !== null) {
        setTaskSelectionDismissed(false);
      }
    }
  }, [archivedEntries, selectedTaskId, taskRunners, taskSelectionDismissed]);

  useEffect(() => {
    const activeTaskIds = new Set(taskRunners.map((runner) => runner.taskId));
    const archivedEntriesByTaskId = new Map(
      archivedEntries.map((runner) => [runner.taskId, runner])
    );

    setTaskCancelUiState((current) => {
      let changed = false;
      const next = { ...current };

      for (const [taskId, state] of Object.entries(current)) {
        const archivedRunner = archivedEntriesByTaskId.get(taskId);

        if (
          (state.phase === "cancelling" || state.phase === "cancel_failed") &&
          archivedRunner?.status === "cancelled"
        ) {
          next[taskId] = {
            phase: "cancelled_confirmed"
          };
          changed = true;
          continue;
        }

        if (
          state.phase === "cancelling" &&
          archivedRunner &&
          archivedRunner.status !== "cancelled"
        ) {
          delete next[taskId];
          changed = true;
          continue;
        }

        if (
          state.phase === "cancel_failed" &&
          !activeTaskIds.has(taskId) &&
          archivedRunner
        ) {
          delete next[taskId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [archivedEntries, taskRunners]);

  useEffect(() => {
    const timeoutHandles = taskCancelTimeoutsRef.current;

    for (const [taskId, timeoutHandle] of timeoutHandles.entries()) {
      if (taskCancelUiState[taskId]?.phase === "cancelled_confirmed") {
        continue;
      }
      clearTimeout(timeoutHandle);
      timeoutHandles.delete(taskId);
    }

    for (const [taskId, state] of Object.entries(taskCancelUiState)) {
      if (state.phase !== "cancelled_confirmed" || timeoutHandles.has(taskId)) {
        continue;
      }

      const timeoutHandle = window.setTimeout(() => {
        taskCancelTimeoutsRef.current.delete(taskId);
        setTaskCancelUiState((current) => {
          if (current[taskId]?.phase !== "cancelled_confirmed") {
            return current;
          }

          const next = { ...current };
          delete next[taskId];
          return next;
        });

        if (selectedTaskIdRef.current === taskId) {
          setSelectedTaskId(null);
          setTaskSelectionDismissed(true);
        }
      }, TASK_CANCEL_CONFIRMATION_DWELL_MS);

      timeoutHandles.set(taskId, timeoutHandle);
    }
  }, [taskCancelUiState]);

  useEffect(
    () => () => {
      for (const timeoutHandle of taskCancelTimeoutsRef.current.values()) {
        clearTimeout(timeoutHandle);
      }
      taskCancelTimeoutsRef.current.clear();
    },
    []
  );

  const handleSelectTask = useCallback((taskId) => {
    if (typeof taskId === "string" && taskId.trim()) {
      setSelectedTaskId(taskId);
      setTaskSelectionDismissed(false);
      return;
    }

    setSelectedTaskId(null);
    setTaskSelectionDismissed(true);
  }, []);

  const historyEntries = useMemo(() => buildHistoryEntries(historySummary), [historySummary]);
  const displayConversationTimeline = useMemo(
    () => buildDisplayConversationTimeline(deferredUiState),
    [deferredUiState]
  );
  const filteredDebugEvents = useMemo(
    () => filterDebugEvents(debugInspector, debugFilters, debugTurnFilter.trim(), debugTaskFilter.trim()),
    [debugFilters, debugInspector, debugTaskFilter, debugTurnFilter]
  );

  const turnsById = useMemo(
    () => new Map((deferredUiState.conversationTurns ?? []).map((turn) => [turn.turnId, turn])),
    [deferredUiState.conversationTurns]
  );

  const avatarState = avatarStateForUi(summary, voiceState, inputState);
  const selectedMicrophoneLabel = useMemo(() => {
    if (!selectedMicId) {
      return microphones[0]?.label || "Default input";
    }

    return (
      microphones.find((device) => device.deviceId === selectedMicId)?.label ||
      "Selected input"
    );
  }, [microphones, selectedMicId]);

  const handlePromptSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (promptComposing) {
        return;
      }
      const text = prompt.trim();
      if (!text) {
        return;
      }

      try {
        hideRuntimeError();
        setPrompt("");
        const relayApp = window.relayApp ?? window.desktopCompanion;
        await relayApp.sendTypedTurn(text);
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, prompt, promptComposing, showRuntimeError]
  );

  const handlePromptKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !promptComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [promptComposing]
  );

  const handleMicToggle = useCallback(async () => {
    try {
      hideRuntimeError();
      await window.desktopSession.toggleMic();
    } catch (error) {
      showRuntimeError(error);
    }
  }, [hideRuntimeError, showRuntimeError]);

  const applyMutedState = useCallback(
    async (muted) => {
      if (recorderStreamRef.current) {
        for (const track of recorderStreamRef.current.getAudioTracks()) {
          track.enabled = !muted;
        }
      }

      if (muted) {
        userSpeakingActiveRef.current = false;
        speechCandidateStartAtRef.current = 0;
        clearTimeout(userSpeakingTimerRef.current);
        endLiveActivity();
      }

      await setRuntimeUserSpeaking(!muted && userSpeakingActiveRef.current);
      await window.desktopLive.setMuted(muted);
    },
    [endLiveActivity, setRuntimeUserSpeaking]
  );

  const handleConnect = useCallback(async () => {
    return connectHostedSession({
      passcode,
      microphoneEnabled: true,
      startMuted: settings.audio.startMuted,
      hideRuntimeError,
      showRuntimeError,
      stopPlayback,
      connect: (judgePasscode) => window.desktopLive.connect(judgePasscode),
      setMuted: applyMutedState,
      requestMicrophoneAccess: () =>
        ensureVoiceCaptureReady({
          enableIfDisabled: true
        }),
      startVoiceCapture,
      stopVoiceCapture,
      disconnect: () => window.desktopLive.disconnect()
    });
  }, [
    applyMutedState,
    ensureVoiceCaptureReady,
    hideRuntimeError,
    passcode,
    settings.audio.startMuted,
    showRuntimeError,
    startVoiceCapture,
    stopPlayback,
    stopVoiceCapture
  ]);

  const handleMuteToggle = useCallback(async () => {
    try {
      hideRuntimeError();
      if (voiceStateRef.current.muted) {
        const ready = await ensureVoiceCaptureReady({
          enableIfDisabled: true
        });
        if (!ready) {
          return;
        }
        await applyMutedState(false);
        return;
      }

      await applyMutedState(true);
    } catch (error) {
      showRuntimeError(error);
    }
  }, [applyMutedState, ensureVoiceCaptureReady, hideRuntimeError, showRuntimeError]);

  const handleHangup = useCallback(async () => {
    try {
      hideRuntimeError();
      await stopVoiceCapture();
      await stopPlayback();
      await setRuntimeAssistantSpeaking(false);
      await window.desktopLive.disconnect();
    } catch (error) {
      showRuntimeError(error);
    }
  }, [hideRuntimeError, setRuntimeAssistantSpeaking, showRuntimeError, stopPlayback, stopVoiceCapture]);

  const handleRefreshHistory = useCallback(async () => {
    try {
      hideRuntimeError();
      await window.desktopUi.refreshHistory();
    } catch (error) {
      showRuntimeError(error);
    }
  }, [hideRuntimeError, showRuntimeError]);

  const handleCancelTask = useCallback(
    async (taskId) => {
      if (
        typeof taskId !== "string" ||
        !taskId.trim() ||
        taskCancelUiState[taskId]?.phase === "cancelling"
      ) {
        return false;
      }

      const confirmed = window.confirm(
        "Force stop this task? Relay will cancel the task and stop the local executor immediately."
      );
      if (!confirmed) {
        return false;
      }

      try {
        hideRuntimeError();
        setTaskCancelUiState((current) => ({
          ...current,
          [taskId]: {
            phase: "cancelling"
          }
        }));
        const accepted = await window.desktopUi.cancelTask(taskId);
        if (!accepted) {
          setTaskCancelUiState((current) => ({
            ...current,
            [taskId]: {
              phase: "cancel_failed"
            }
          }));
          return false;
        }
        return true;
      } catch {
        setTaskCancelUiState((current) => ({
          ...current,
          [taskId]: {
            phase: "cancel_failed"
          }
        }));
        return false;
      }
    },
    [hideRuntimeError, taskCancelUiState]
  );

  const handleRetryExecutorHealthCheck = useCallback(async () => {
    await runExecutorHealthRefresh();
  }, [runExecutorHealthRefresh]);

  const handleRefreshMicrophones = useCallback(async () => {
    try {
      hideRuntimeError();
      await populateMicrophones();
    } catch (error) {
      showRuntimeError(error);
    }
  }, [hideRuntimeError, populateMicrophones, showRuntimeError]);

  const handleSelectMicrophone = useCallback(
    async (deviceId) => {
      const nextDeviceId = typeof deviceId === "string" ? deviceId : "";
      setSelectedMicId(nextDeviceId);
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          audio: {
            defaultMicId: nextDeviceId
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleStartMutedChange = useCallback(
    async (startMuted) => {
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          audio: {
            startMuted: Boolean(startMuted)
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleVoiceCaptureEnabledChange = useCallback(
    async (enabled) => {
      try {
        hideRuntimeError();
        if (!enabled) {
          await applyMutedState(true).catch(() => undefined);
          await stopVoiceCapture().catch(() => undefined);
          await updateDesktopSettings({
            audio: {
              voiceCaptureEnabled: false
            }
          });
          await refreshSetupStatus({ refresh: false });
          return true;
        }

        const ready = await ensureVoiceCaptureReady({
          enableIfDisabled: true
        });
        if (!ready) {
          return false;
        }

        await updateDesktopSettings({
          audio: {
            voiceCaptureEnabled: true
          }
        });

        if (voiceStateRef.current.connected) {
          await applyMutedState(Boolean(settings.audio.startMuted));
        }

        return true;
      } catch (error) {
        showRuntimeError(error);
        return false;
      }
    },
    [
      applyMutedState,
      ensureVoiceCaptureReady,
      hideRuntimeError,
      refreshSetupStatus,
      settings.audio.startMuted,
      showRuntimeError,
      stopVoiceCapture,
      updateDesktopSettings
    ]
  );

  const handleExecutorEnabledChange = useCallback(
    async (enabled) => {
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          executor: {
            enabled: Boolean(enabled)
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleMotionPreferenceChange = useCallback(
    async (motionPreference) => {
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          ui: {
            motionPreference
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleHeaderHealthWarningsChange = useCallback(
    async (showHeaderHealthWarnings) => {
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          ui: {
            showHeaderHealthWarnings: Boolean(showHeaderHealthWarnings)
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleToggleDebugFilter = useCallback(
    async (source) => {
      const nextFilters = {
        ...debugFilters,
        [source]: !debugFilters[source]
      };
      setDebugFilters(nextFilters);
      try {
        hideRuntimeError();
        await updateDesktopSettings({
          debug: {
            defaultFilters: nextFilters
          }
        });
      } catch (error) {
        showRuntimeError(error);
      }
    },
    [debugFilters, hideRuntimeError, showRuntimeError, updateDesktopSettings]
  );

  const handleOpenDeveloperConsole = useCallback(() => {
    setDebugOpen(true);
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      hideRuntimeError();
      return await window.desktopUi.copyDiagnosticsSnapshot();
    } catch (error) {
      showRuntimeError(error);
      return null;
    }
  }, [hideRuntimeError, showRuntimeError]);

  const handleResetSettings = useCallback(async () => {
    try {
      hideRuntimeError();
      await window.desktopUi.resetSettings();
      await populateMicrophones();
      await refreshSetupStatus({ refresh: false });
    } catch (error) {
      showRuntimeError(error);
    }
  }, [hideRuntimeError, populateMicrophones, refreshSetupStatus, showRuntimeError]);

  const handleRequestMicrophoneAccess = useCallback(async () => {
    try {
      hideRuntimeError();
      const granted = await requestMicrophoneAccessWithCapture();
      if (granted && settings.audio.voiceCaptureEnabled === false) {
        await updateDesktopSettings({
          audio: {
            voiceCaptureEnabled: true
          }
        });
      }
      return granted;
    } catch (error) {
      showRuntimeError(error);
      return false;
    }
  }, [
    hideRuntimeError,
    requestMicrophoneAccessWithCapture,
    settings.audio.voiceCaptureEnabled,
    showRuntimeError,
    updateDesktopSettings
  ]);

  const handleCopyText = useCallback(
    async (text) => {
      try {
        hideRuntimeError();
        return await window.desktopUi.copyText(text);
      } catch (error) {
        showRuntimeError(error);
        return null;
      }
    },
    [hideRuntimeError, showRuntimeError]
  );

  const handleOpenSupportTarget = useCallback(
    async (target) => {
      try {
        hideRuntimeError();
        return await window.desktopUi.openSupportTarget(target);
      } catch (error) {
        showRuntimeError(error);
        return false;
      }
    },
    [hideRuntimeError, showRuntimeError]
  );

  const handleOpenGeminiLoginTerminal = useCallback(async () => {
    try {
      hideRuntimeError();
      const opened = await window.desktopUi.openGeminiLoginTerminal();
      if (opened) {
        pendingExecutorHealthRefreshRef.current = true;
      }
      return opened;
    } catch (error) {
      showRuntimeError(error);
      return false;
    }
  }, [hideRuntimeError, showRuntimeError]);

  return {
    archivedEntries,
    audioEnergy,
    avatarState,
    chatOpen,
    debugFilters,
    debugOpen,
    debugTaskFilter,
    debugTurnFilter,
    displayConversationTimeline,
    deferredUiState,
    executorHealth,
    filteredDebugEvents,
    handleCancelTask,
    handleConnect,
    handleCopyDiagnostics,
    handleCopyText,
    handleExecutorEnabledChange,
    handleHangup,
    handleHeaderHealthWarningsChange,
    handleMicToggle,
    handleVoiceCaptureEnabledChange,
    handleMuteToggle,
    handleMotionPreferenceChange,
    handleOpenGeminiLoginTerminal,
    handleOpenDeveloperConsole,
    handleOpenSupportTarget,
    handlePromptKeyDown,
    handlePromptSubmit,
    handleRefreshHistory,
    handleRefreshMicrophones,
    handleRequestMicrophoneAccess,
    handleResetSettings,
    refreshSetupStatus,
    handleRetryExecutorHealthCheck,
    handleSelectMicrophone,
    handleStartMutedChange,
    handleToggleDebugFilter,
    historyEntries,
    historyOpen,
    historySummary,
    inputEnergy,
    microphones,
    mouthOpen,
    passcode,
    prefersReducedMotion,
    prompt,
    promptComposing,
    runtimeError,
    selectedMicId,
    selectedMicrophoneLabel,
    setupStatus,
    setupStatusLoading,
    taskCancelUiState,
    selectedTaskId,
    taskSelectionDismissed,
    setChatOpen,
    setDebugOpen,
    setDebugTaskFilter,
    setDebugTurnFilter,
    setHistoryOpen,
    setPasscode,
    setPrompt,
    setPromptComposing,
    setSettingsOpen,
    handleSelectTask,
    settings,
    settingsOpen,
    summary,
    systemStatus,
    taskRunners,
    turnsById,
    voiceState
  };
}
