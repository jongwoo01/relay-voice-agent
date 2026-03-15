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
import {
  buildDisplayConversationTimeline,
  buildArchivedTaskEntries,
  buildHistoryEntries,
  buildTaskRunnerEntries,
  filterDebugEvents
} from "../ui-utils.js";

const LIVE_INPUT_BUFFER_SIZE = 512;
const LIVE_SPEECH_ACTIVITY_THRESHOLD = 0.03;
const LIVE_SPEECH_IDLE_MS = 320;
const LIVE_BARGE_IN_CONFIRM_MS = 140;
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
  conversationTimeline: [],
  conversationTurns: [],
  activeTurnId: null,
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
  historySummary: { loading: false, error: null, sessions: [] },
  voiceControlState: {
    connected: false,
    connecting: false,
    status: "idle",
    muted: false,
    error: null,
    routing: { mode: "idle", summary: "", detail: "" },
    mic: { mode: "idle", enabled: false },
    activity: { userSpeaking: false, assistantSpeaking: false }
  },
  inputState: { inFlight: false, queueSize: 0, activeText: null, lastError: null },
  runtimeError: null
};

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

function avatarStateForUi(summary, voiceState, inputState) {
  if (voiceState.status === "interrupted") {
    return "interrupted";
  }

  if (voiceState.activity?.assistantSpeaking) {
    return "speaking";
  }

  if (summary.avatar?.mainState === "thinking" || inputState.inFlight) {
    return "thinking";
  }

  if (voiceState.activity?.userSpeaking || voiceState.status === "listening") {
    return "listening";
  }

  return "idle";
}

export function useDesktopAppController() {
  const [uiState, setUiState] = useState(EMPTY_UI_STATE);
  const deferredUiState = useDeferredValue(uiState);
  const [runtimeError, setRuntimeError] = useState(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [promptComposing, setPromptComposing] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [microphones, setMicrophones] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [debugFilters, setDebugFilters] = useState(DEBUG_FILTER_DEFAULTS);
  const [debugTurnFilter, setDebugTurnFilter] = useState("");
  const [debugTaskFilter, setDebugTaskFilter] = useState("");
  const mouthOpen = useMotionValue(0);
  const audioEnergy = useMotionValue(0);
  const inputEnergy = useMotionValue(0);

  const uiStateRef = useRef(uiState);
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
  const recorderFallbackNodeRef = useRef(null);
  const recorderGainNodeRef = useRef(null);
  const userSpeakingTimerRef = useRef(null);
  const userSpeakingActiveRef = useRef(false);
  const speechCandidateStartAtRef = useRef(0);
  const liveActivityActiveRef = useRef(false);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    if (!window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener?.("change", update);

    return () => {
      mediaQuery.removeEventListener?.("change", update);
    };
  }, []);

  const voiceState = deferredUiState.voiceControlState ?? EMPTY_UI_STATE.voiceControlState;
  const summary = deferredUiState.taskSummary ?? EMPTY_UI_STATE.taskSummary;
  const historySummary = deferredUiState.historySummary ?? EMPTY_UI_STATE.historySummary;
  const inputState = deferredUiState.inputState ?? EMPTY_UI_STATE.inputState;
  const debugInspector = deferredUiState.debugInspector ?? EMPTY_UI_STATE.debugInspector;

  const voiceStateRef = useRef(voiceState);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  const showRuntimeError = useCallback((error) => {
    setRuntimeError(error instanceof Error ? error.message : String(error));
  }, []);

  const hideRuntimeError = useCallback(() => {
    setRuntimeError(null);
  }, []);

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

  const handleAudioChunk = useCallback(
    async (chunk) => {
      if (
        userSpeakingActiveRef.current ||
        Date.now() < audioIgnoreUntilRef.current ||
        voiceStateRef.current.status === "interrupted"
      ) {
        return;
      }

      audioQueueRef.current.push(base64ToFloat32AudioData(chunk.data));
      await playQueuedAudio();
    },
    [playQueuedAudio]
  );

  const startLiveActivity = useCallback(() => {
    if (liveActivityActiveRef.current) {
      return;
    }

    liveActivityActiveRef.current = true;
    window.desktopLive?.startActivity?.();
  }, []);

  const endLiveActivity = useCallback(() => {
    if (!liveActivityActiveRef.current) {
      return;
    }

    liveActivityActiveRef.current = false;
    window.desktopLive?.endActivity?.();
  }, []);

  const scheduleUserSpeakingReset = useCallback(() => {
    clearTimeout(userSpeakingTimerRef.current);
    userSpeakingTimerRef.current = setTimeout(() => {
      userSpeakingActiveRef.current = false;
      speechCandidateStartAtRef.current = 0;
      inputEnergy.set(0);
      endLiveActivity();
      void setRuntimeUserSpeaking(false).catch(showRuntimeError);
    }, LIVE_SPEECH_IDLE_MS);
  }, [endLiveActivity, inputEnergy, setRuntimeUserSpeaking, showRuntimeError]);

  const handleLiveUserAudioActivity = useCallback(
    (peak) => {
      if (peak < LIVE_SPEECH_ACTIVITY_THRESHOLD) {
        speechCandidateStartAtRef.current = 0;
        return;
      }

      const now = Date.now();
      if (!speechCandidateStartAtRef.current) {
        speechCandidateStartAtRef.current = now;
      }

      if (now - speechCandidateStartAtRef.current < LIVE_BARGE_IN_CONFIRM_MS) {
        return;
      }

      if (!userSpeakingActiveRef.current) {
        void stopPlayback();
        userSpeakingActiveRef.current = true;
        startLiveActivity();
        void setRuntimeUserSpeaking(true).catch(showRuntimeError);
      }

      scheduleUserSpeakingReset();
    },
    [scheduleUserSpeakingReset, setRuntimeUserSpeaking, showRuntimeError, startLiveActivity, stopPlayback]
  );

  const populateMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput");
    setMicrophones(inputs);
    setSelectedMicId((current) => current || inputs[0]?.deviceId || "");
  }, []);

  const stopVoiceCapture = useCallback(async () => {
    clearTimeout(userSpeakingTimerRef.current);
    userSpeakingActiveRef.current = false;
    speechCandidateStartAtRef.current = 0;
    endLiveActivity();
    inputEnergy.set(0);
    recorderFallbackNodeRef.current?.disconnect();
    recorderGainNodeRef.current?.disconnect();
    recorderSourceRef.current?.disconnect();
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
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

    const constraints = {
      audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true
    };

    recorderStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
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
    recorderFallbackNodeRef.current = recorderContextRef.current.createScriptProcessor(
      LIVE_INPUT_BUFFER_SIZE,
      1,
      1
    );
    recorderFallbackNodeRef.current.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      let peak = 0;

      for (let index = 0; index < inputData.length; index += 1) {
        const value = Math.max(-1, Math.min(1, inputData[index]));
        peak = Math.max(peak, Math.abs(value));
        pcm16[index] = value * 32768;
      }

      inputEnergy.set(Math.min(1, peak / 0.18));
      handleLiveUserAudioActivity(peak);
      window.desktopLive.sendAudioChunk(
        arrayBufferToBase64(pcm16.buffer),
        "audio/pcm;rate=16000"
      );
    };

    recorderGainNodeRef.current = recorderContextRef.current.createGain();
    recorderGainNodeRef.current.gain.value = 0;
    recorderSourceRef.current.connect(recorderFallbackNodeRef.current);
    recorderFallbackNodeRef.current.connect(recorderGainNodeRef.current);
    recorderGainNodeRef.current.connect(recorderContextRef.current.destination);
  }, [handleLiveUserAudioActivity, inputEnergy, populateMicrophones, selectedMicId]);

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
        startTransition(() => {
          setUiState(nextState);
        });
      });

      unsubscribeAudio = window.desktopLive.onAudioChunk((chunk) => {
        void handleAudioChunk(chunk);
      });

      await populateMicrophones();
    }

    bootstrap().catch(showRuntimeError);

    const onDeviceChange = () => {
      void populateMicrophones().catch(showRuntimeError);
    };
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        setDebugOpen((current) => !current);
      }
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeAudio();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
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
    showRuntimeError,
    stopPlayback,
    stopVoiceCapture
  ]);

  useEffect(() => {
    const shouldStop = voiceState.status === "interrupted" || !voiceState.connected;
    if (shouldStop) {
      void stopPlayback();
    }
  }, [stopPlayback, voiceState.connected, voiceState.status]);

  const taskRunners = useMemo(() => buildTaskRunnerEntries(summary), [summary]);
  const archivedEntries = useMemo(() => buildArchivedTaskEntries(summary), [summary]);

  const prevEntriesRef = useRef([]);

  useEffect(() => {
    const allEntries = [...taskRunners, ...archivedEntries];
    const prevEntries = prevEntriesRef.current;
    prevEntriesRef.current = allEntries;

    if (allEntries.length === 0) {
      if (selectedTaskId !== null) {
        setSelectedTaskId(null);
      }
      return;
    }

    // 1. Proactively select tasks that entered a state needing attention
    const criticalTask = allEntries.find((runner) => {
      const prev = prevEntries.find((p) => p.taskId === runner.taskId);
      const isNewCritical =
        (runner.status === "waiting_input" ||
          runner.status === "approval_required" ||
          runner.status === "failed") &&
        (!prev || prev.status !== runner.status);
      return isNewCritical;
    });

    if (criticalTask) {
      setSelectedTaskId(criticalTask.taskId);
      return;
    }

    // 2. If the current selection disappeared (e.g. deleted or moved but lost ID), reset to the first one available
    const currentStillExists =
      selectedTaskId && allEntries.some((r) => r.taskId === selectedTaskId);

    if (selectedTaskId !== null && !currentStillExists) {
      setSelectedTaskId(allEntries[0]?.taskId ?? null);
      return;
    }

    // 3. Initial auto-selection: if we have tasks, nothing is selected, AND we haven't ever selected anything yet
    // This allows the user to explicitly close (null) while still having a good first-run experience.
    if (selectedTaskId === null && prevEntries.length === 0 && allEntries.length > 0) {
      setSelectedTaskId(allEntries[0].taskId);
    }
  }, [archivedEntries, selectedTaskId, taskRunners]);

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
        await window.desktopCompanion.sendTypedTurn(text);
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

  const handleConnect = useCallback(async () => {
    try {
      hideRuntimeError();
      await stopPlayback();
      await window.desktopLive.connect(passcode.trim());
      await startVoiceCapture();
    } catch (error) {
      showRuntimeError(error);
      await stopVoiceCapture().catch(() => undefined);
      await window.desktopLive.disconnect().catch(() => undefined);
    }
  }, [hideRuntimeError, passcode, showRuntimeError, startVoiceCapture, stopPlayback, stopVoiceCapture]);

  const handleMuteToggle = useCallback(async () => {
    try {
      hideRuntimeError();
      const nextMuted = !voiceStateRef.current.muted;
      if (recorderStreamRef.current) {
        for (const track of recorderStreamRef.current.getAudioTracks()) {
          track.enabled = !nextMuted;
        }
        if (nextMuted) {
          userSpeakingActiveRef.current = false;
          speechCandidateStartAtRef.current = 0;
          clearTimeout(userSpeakingTimerRef.current);
          endLiveActivity();
        }

        await setRuntimeUserSpeaking(!nextMuted && userSpeakingActiveRef.current);
      }

      await window.desktopLive.setMuted(nextMuted);
    } catch (error) {
      showRuntimeError(error);
    }
  }, [endLiveActivity, hideRuntimeError, setRuntimeUserSpeaking, showRuntimeError]);

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
    filteredDebugEvents,
    handleConnect,
    handleHangup,
    handleMicToggle,
    handleMuteToggle,
    handlePromptKeyDown,
    handlePromptSubmit,
    handleRefreshHistory,
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
    selectedTaskId,
    setChatOpen,
    setDebugFilters,
    setDebugOpen,
    setDebugTaskFilter,
    setDebugTurnFilter,
    setHistoryOpen,
    setPasscode,
    setPrompt,
    setPromptComposing,
    setSelectedMicId,
    setSelectedTaskId,
    summary,
    taskRunners,
    turnsById,
    voiceState
  };
}
