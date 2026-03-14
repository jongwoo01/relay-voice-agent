const conversationFeedEl = document.getElementById("conversation-feed");
const composerEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const runtimeMetaEl = document.getElementById("runtime-meta");
const inputStatusEl = document.getElementById("input-status");
const executorBadgeEl = document.getElementById("executor-badge");
const micStateEl = document.getElementById("mic-state");
const micToggleEl = document.getElementById("mic-toggle");
const userSpeakingStateEl = document.getElementById("user-speaking-state");
const assistantSpeakingStateEl = document.getElementById(
  "assistant-speaking-state"
);
const runtimeErrorEl = document.getElementById("runtime-error");
const liveStatusBadgeEl = document.getElementById("live-status-badge");
const liveStatusTextEl = document.getElementById("live-status-text");
const liveConnectButtonEl = document.getElementById("live-connect-button");
const liveMuteButtonEl = document.getElementById("live-mute-button");
const liveHangupButtonEl = document.getElementById("live-hangup-button");
const livePasscodeEl = document.getElementById("live-passcode");
const liveMicSelectEl = document.getElementById("live-mic-select");
const pendingBriefingsCountEl = document.getElementById(
  "pending-briefings-count"
);
const taskRunnerListEl = document.getElementById("task-runner-list");
const taskDrawerCountEl = document.getElementById("task-drawer-count");
const taskDrawerDescriptionEl = document.getElementById(
  "task-drawer-description"
);
const taskDrawerListEl = document.getElementById("task-drawer-list");
const historyDrawerCountEl = document.getElementById("history-drawer-count");
const historyDrawerDescriptionEl = document.getElementById(
  "history-drawer-description"
);
const historyDrawerListEl = document.getElementById("history-drawer-list");
const historyRefreshButtonEl = document.getElementById("history-refresh-button");
const debugEventListEl = document.getElementById("debug-event-list");
const debugTurnFilterEl = document.getElementById("debug-turn-filter");
const debugTaskFilterEl = document.getElementById("debug-task-filter");
const debugSourceFilterEls = [
  ...document.querySelectorAll("[data-source-filter]")
];

const debugSourceFilters = new Set(
  debugSourceFilterEls.map((element) => element.dataset.sourceFilter)
);
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

let desktopUiState = null;
let liveAudioContext;
let liveRecorderContext;
let liveRecorderSource;
let liveRecorderStream;
let liveRecorderFallbackNode;
let liveRecorderGainNode;
let liveAudioQueue = [];
let liveAudioQueueProcessing = false;
let liveAudioNextStartTime = 0;
let liveAudioIgnoreUntil = 0;
let liveLastProducedAudioAt = null;
let liveUserSpeakingTimer;
let liveUserSpeakingActive = false;
let liveSpeechCandidateStartAt = 0;
let promptComposing = false;
let selectedTaskRunnerId = null;
let scheduledUiState = null;
let scheduledRenderFrame = null;
const renderStateCache = {
  chrome: null,
  conversation: null,
  summary: null,
  taskRunners: null,
  taskDrawer: null,
  historyDrawer: null,
  debugInspector: null
};
const activeAudioSources = [];
const LIVE_INPUT_BUFFER_SIZE = 512;
const LIVE_SPEECH_ACTIVITY_THRESHOLD = 0.03;
const LIVE_SPEECH_IDLE_MS = 320;
const LIVE_BARGE_IN_CONFIRM_MS = 140;

window.addEventListener("error", (event) => {
  console.error("[desktop-renderer] uncaught error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error instanceof Error ? event.error.stack : null
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  console.error(
    "[desktop-renderer] unhandled rejection",
    reason instanceof Error
      ? {
          name: reason.name,
          message: reason.message,
          stack: reason.stack ?? null
        }
      : reason
  );
});

function getVoiceState() {
  return (
    desktopUiState?.voiceControlState ?? {
      connected: false,
      connecting: false,
      status: "idle",
      muted: false,
      error: null,
      routing: { mode: "idle", summary: "", detail: "" },
      mic: { mode: "idle", enabled: false },
      activity: { userSpeaking: false, assistantSpeaking: false }
    }
  );
}

function getTaskSummary() {
  return (
    desktopUiState?.taskSummary ?? {
      activeTasks: [],
      recentTasks: [],
      taskTimelines: [],
      taskRunnerDetails: [],
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      notifications: { pending: [], delivered: [] },
      pendingBriefingCount: 0
    }
  );
}

function getHistorySummary() {
  return (
    desktopUiState?.historySummary ?? {
      loading: false,
      error: null,
      sessions: []
    }
  );
}

function showRuntimeError(error) {
  runtimeErrorEl.hidden = false;
  runtimeErrorEl.textContent =
    error instanceof Error ? error.message : String(error);
}

function hideRuntimeError() {
  runtimeErrorEl.hidden = true;
  runtimeErrorEl.textContent = "";
}

function formatTime(iso) {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return timeFormatter.format(date);
}

function buildChromeSignature(state, voiceState, inputState) {
  return JSON.stringify({
    brainSessionId: state.brainSessionId ?? null,
    executionMode: state.executionMode ?? null,
    inputInFlight: inputState.inFlight ?? false,
    inputActiveText: inputState.activeText ?? null,
    micMode: voiceState.mic?.mode ?? null,
    micEnabled: voiceState.mic?.enabled ?? false,
    userSpeaking: voiceState.activity?.userSpeaking ?? false,
    assistantSpeaking: voiceState.activity?.assistantSpeaking ?? false,
    liveStatus: voiceState.status ?? null,
    liveConnected: voiceState.connected ?? false,
    liveConnecting: voiceState.connecting ?? false,
    liveMuted: voiceState.muted ?? false,
    liveError: voiceState.error ?? null,
    runtimeError: state.runtimeError ?? null
  });
}

function buildConversationSignature(state) {
  return JSON.stringify({
    activeTurnId: state.activeTurnId ?? null,
    turns: (state.conversationTurns ?? []).map((turn) => ({
      turnId: turn.turnId,
      stage: turn.stage,
      updatedAt: turn.updatedAt ?? null
    })),
    timeline: (state.conversationTimeline ?? []).map((item) => ({
      id: item.id,
      turnId: item.turnId,
      text: item.text,
      partial: item.partial,
      streaming: item.streaming,
      interrupted: item.interrupted,
      taskStatus: item.taskStatus ?? null,
      updatedAt: item.updatedAt ?? item.createdAt ?? null
    }))
  });
}

function buildSummarySignature(summary, voiceState) {
  return JSON.stringify({
    mainState: summary.avatar?.mainState ?? null,
    taskRunnerCount: summary.avatar?.taskRunners?.length ?? 0,
    activeStatuses: (summary.activeTasks ?? []).map((task) => ({
      id: task.id,
      status: task.status
    })),
    intake: summary.intake ?? null,
    pendingBriefingCount: summary.pendingBriefingCount ?? 0,
    routing: voiceState.routing ?? null
  });
}

function buildTaskRunnerSignature(summary, debugInspector) {
  const selectedTaskId = selectedTaskRunnerId;
  const selectedExecutionEvents = (debugInspector?.events ?? [])
    .filter((event) => event.source === "executor" && event.taskId === selectedTaskId)
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt
    }));

  return JSON.stringify({
    selectedTaskId,
    taskRunners: (summary.avatar?.taskRunners ?? []).map((runner) => ({
      taskId: runner.taskId,
      title: runner.title,
      status: runner.status,
      latestHumanUpdate: runner.latestHumanUpdate ?? null,
      needsUserAction: runner.needsUserAction ?? null,
      lastUpdatedAt: runner.lastUpdatedAt ?? null
    })),
    taskRunnerDetails: (summary.taskRunnerDetails ?? []).map((detail) => ({
      taskId: detail.taskId,
      status: detail.status,
      heroSummary: detail.heroSummary,
      lastUpdatedAt: detail.lastUpdatedAt ?? null,
      timelineCount: detail.timeline?.length ?? 0,
      resultSummary: detail.resultSummary ?? null,
      detailedAnswer: detail.detailedAnswer ?? null,
      keyFindingsCount: detail.keyFindings?.length ?? 0,
      executionTraceCount: detail.executionTrace?.length ?? 0
    })),
    activeTasks: (summary.activeTasks ?? []).map((task) => ({
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt ?? null
    })),
    selectedExecutionEvents
  });
}

function createConversationRoleLabel(item) {
  return item.kind === "task_event"
    ? "task event"
    : item.speaker === "user"
      ? "you"
      : item.responseSource
        ? `assistant · ${item.responseSource}`
        : "assistant";
}

function createConversationRow(item, turn) {
  const row = document.createElement("article");
  row.className = `conversation-row ${item.speaker}`;
  row.dataset.key = buildConversationKey(item);

  const bubble = document.createElement("div");
  bubble.className = `conversation-bubble${item.partial ? " partial" : ""}${item.streaming ? " streaming" : ""}${item.interrupted ? " interrupted" : ""}`;

  const meta = document.createElement("div");
  meta.className = "conversation-meta";

  const role = document.createElement("p");
  role.className = "message-role";
  role.textContent = createConversationRoleLabel(item);
  meta.appendChild(role);

  const modeChip = document.createElement("span");
  modeChip.className = "turn-chip";
  modeChip.textContent = item.inputMode;
  meta.appendChild(modeChip);

  if (turn?.stage) {
    const stage = document.createElement("span");
    stage.className = "bubble-status";
    stage.textContent = turn.stage;
    meta.appendChild(stage);
  }

  if (item.partial) {
    const partial = document.createElement("span");
    partial.className = "bubble-status";
    partial.textContent = "partial";
    meta.appendChild(partial);
  }

  if (item.interrupted) {
    const interrupted = document.createElement("span");
    interrupted.className = "bubble-status";
    interrupted.textContent = "interrupted";
    meta.appendChild(interrupted);
  }

  const time = document.createElement("span");
  time.className = "bubble-status";
  time.textContent = formatTime(item.updatedAt || item.createdAt);
  meta.appendChild(time);

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = item.text;

  bubble.appendChild(meta);
  bubble.appendChild(text);

  if (item.taskId || item.taskStatus) {
    const chip = document.createElement("div");
    chip.className = `task-chip ${item.taskStatus ?? ""}`.trim();
    chip.textContent = item.taskId
      ? `${item.taskId}${item.taskStatus ? ` · ${item.taskStatus}` : ""}`
      : item.taskStatus;
    bubble.appendChild(chip);
  }

  row.appendChild(bubble);
  return row;
}

function patchConversationRow(row, item, turn) {
  row.className = `conversation-row ${item.speaker}`;
  row.dataset.key = buildConversationKey(item);
  row.replaceChildren(createConversationRow(item, turn).firstElementChild);
}

function buildTaskDrawerSignature(summary) {
  return JSON.stringify({
    selectedTaskId: selectedTaskRunnerId,
    recentTasks: (summary.recentTasks ?? []).map((task) => ({
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt ?? null
    })),
    taskRunnerDetails: (summary.taskRunnerDetails ?? []).map((detail) => ({
      taskId: detail.taskId,
      heroSummary: detail.heroSummary,
      resultSummary: detail.resultSummary ?? null,
      detailedAnswer: detail.detailedAnswer ?? null,
      verification: detail.verification ?? null,
      changes: detail.changes ?? [],
      keyFindingsCount: detail.keyFindings?.length ?? 0,
      executionTraceCount: detail.executionTrace?.length ?? 0
    })),
    activeTaskIds: (summary.activeTasks ?? []).map((task) => task.id),
    notifications: [
      ...(summary.notifications?.delivered ?? []),
      ...(summary.notifications?.pending ?? [])
    ].map((plan) => ({
      taskId: plan.taskId ?? null,
      reason: plan.reason ?? null,
      delivery: plan.delivery ?? null,
      uiText: plan.uiText ?? null,
      createdAt: plan.createdAt ?? null
    }))
  });
}

function buildDebugSignature(debugInspector) {
  return JSON.stringify({
    filters: [...debugSourceFilters].sort(),
    turnFilter: debugTurnFilterEl.value.trim(),
    taskFilter: debugTaskFilterEl.value.trim(),
    events: (debugInspector?.events ?? []).map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      source: event.source,
      kind: event.kind,
      taskId: event.taskId ?? null,
      turnId: event.turnId ?? null
    }))
  });
}

function buildHistorySignature(historySummary) {
  return JSON.stringify({
    loading: historySummary.loading ?? false,
    error: historySummary.error ?? null,
    sessions: (historySummary.sessions ?? []).map((session) => ({
      brainSessionId: session.brainSessionId,
      status: session.status,
      updatedAt: session.updatedAt ?? null,
      lastUserMessage: session.lastUserMessage ?? null,
      lastAssistantMessage: session.lastAssistantMessage ?? null,
      recentTasks: (session.recentTasks ?? []).map((task) => ({
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt ?? null,
        summary: task.summary ?? null
      }))
    }))
  });
}

function formatLatency(fromIso, toIso) {
  if (!fromIso || !toIso) {
    return "n/a";
  }

  const deltaMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return deltaMs >= 0 ? `${deltaMs}ms` : "n/a";
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

function stopPlayback() {
  liveAudioQueue = [];
  activeAudioSources.splice(0).forEach((source) => {
    try {
      source.stop();
      source.disconnect();
    } catch (_error) {
      // noop
    }
  });
  liveAudioNextStartTime = 0;
  liveAudioQueueProcessing = false;
  liveAudioIgnoreUntil = Date.now() + 250;
  void setRuntimeAssistantSpeaking(false).catch(showRuntimeError);
}

async function setRuntimeUserSpeaking(speaking) {
  if (getVoiceState().activity?.userSpeaking === speaking) {
    return;
  }

  await window.desktopSession.setUserSpeaking(speaking);
}

async function setRuntimeAssistantSpeaking(speaking) {
  if (getVoiceState().activity?.assistantSpeaking === speaking) {
    return;
  }

  await window.desktopSession.setAssistantSpeaking(speaking);
}

function scheduleUserSpeakingReset() {
  clearTimeout(liveUserSpeakingTimer);
  liveUserSpeakingTimer = setTimeout(() => {
    liveUserSpeakingActive = false;
    liveSpeechCandidateStartAt = 0;
    void setRuntimeUserSpeaking(false).catch(showRuntimeError);
  }, LIVE_SPEECH_IDLE_MS);
}

function handleLiveUserAudioActivity(peak) {
  if (peak < LIVE_SPEECH_ACTIVITY_THRESHOLD) {
    liveSpeechCandidateStartAt = 0;
    return;
  }

  const now = Date.now();
  if (!liveSpeechCandidateStartAt) {
    liveSpeechCandidateStartAt = now;
  }

  if (now - liveSpeechCandidateStartAt < LIVE_BARGE_IN_CONFIRM_MS) {
    return;
  }

  if (!liveUserSpeakingActive) {
    stopPlayback();
    liveUserSpeakingActive = true;
    void setRuntimeUserSpeaking(true).catch(showRuntimeError);
  }

  scheduleUserSpeakingReset();
}

async function ensurePlaybackContext() {
  if (!liveAudioContext || liveAudioContext.state === "closed") {
    liveAudioContext = new AudioContext();
    liveAudioNextStartTime = liveAudioContext.currentTime;
  }

  if (liveAudioContext.state === "suspended") {
    await liveAudioContext.resume();
  }
}

async function playQueuedAudio() {
  if (liveAudioQueueProcessing || liveAudioQueue.length === 0) {
    return;
  }

  liveAudioQueueProcessing = true;

  try {
    await ensurePlaybackContext();
    await setRuntimeAssistantSpeaking(true);

    while (liveAudioQueue.length > 0) {
      const chunk = liveAudioQueue.shift();
      const audioBuffer = liveAudioContext.createBuffer(1, chunk.length, 24000);
      audioBuffer.copyToChannel(chunk, 0);

      const source = liveAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(liveAudioContext.destination);
      activeAudioSources.push(source);
      source.onended = () => {
        const index = activeAudioSources.indexOf(source);
        if (index >= 0) {
          activeAudioSources.splice(index, 1);
        }
      };

      if (liveAudioNextStartTime < liveAudioContext.currentTime) {
        liveAudioNextStartTime = liveAudioContext.currentTime;
      }

      source.start(liveAudioNextStartTime);
      liveAudioNextStartTime += audioBuffer.duration;
    }

    const waitMs = Math.max(
      0,
      (liveAudioNextStartTime - liveAudioContext.currentTime) * 1000
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } finally {
    liveAudioQueueProcessing = false;
    if (liveAudioQueue.length > 0) {
      void playQueuedAudio();
      return;
    }

    await setRuntimeAssistantSpeaking(false);
  }
}

async function handleAudioChunk(chunk) {
  if (
    liveUserSpeakingActive ||
    Date.now() < liveAudioIgnoreUntil ||
    getVoiceState().status === "interrupted"
  ) {
    return;
  }
  liveAudioQueue.push(base64ToFloat32AudioData(chunk.data));
  await playQueuedAudio();
}

async function populateMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    liveStatusTextEl.textContent = "This environment does not support microphone device discovery.";
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const existingValue = liveMicSelectEl.value;
  liveMicSelectEl.innerHTML = '<option value="">Default microphone</option>';

  for (const device of inputs) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${liveMicSelectEl.length}`;
    liveMicSelectEl.appendChild(option);
  }

  if (existingValue) {
    liveMicSelectEl.value = existingValue;
  } else if (inputs[0]) {
    liveMicSelectEl.value = inputs[0].deviceId;
  }
}

async function stopVoiceCapture() {
  clearTimeout(liveUserSpeakingTimer);
  await window.desktopLive.endAudioStream().catch(() => undefined);
  liveUserSpeakingActive = false;
  liveSpeechCandidateStartAt = 0;
  liveRecorderFallbackNode?.disconnect();
  liveRecorderGainNode?.disconnect();
  liveRecorderSource?.disconnect();
  liveRecorderStream?.getTracks().forEach((track) => track.stop());
  liveRecorderFallbackNode = undefined;
  liveRecorderGainNode = undefined;
  liveRecorderSource = undefined;
  liveRecorderStream = undefined;

  if (liveRecorderContext && liveRecorderContext.state !== "closed") {
    await liveRecorderContext.close();
  }
  liveRecorderContext = undefined;
  liveLastProducedAudioAt = null;
  await setRuntimeUserSpeaking(false);
}

async function startVoiceCapture() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available in this environment.");
  }

  const deviceId = liveMicSelectEl.value;
  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  };
  liveStatusTextEl.textContent = "Requesting microphone permission…";
  liveRecorderStream = await navigator.mediaDevices.getUserMedia(constraints);
  liveStatusTextEl.textContent = "Microphone connected. Connecting to Gemini Live…";
  await populateMicrophones();

  liveRecorderContext = new AudioContext({
    sampleRate: 16000,
    latencyHint: "interactive"
  });
  if (liveRecorderContext.state === "suspended") {
    await liveRecorderContext.resume();
  }

  liveRecorderSource =
    liveRecorderContext.createMediaStreamSource(liveRecorderStream);
  liveRecorderFallbackNode = liveRecorderContext.createScriptProcessor(
    LIVE_INPUT_BUFFER_SIZE,
    1,
    1
  );
  liveRecorderFallbackNode.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);
    let peak = 0;

    for (let index = 0; index < inputData.length; index += 1) {
      const value = Math.max(-1, Math.min(1, inputData[index]));
      peak = Math.max(peak, Math.abs(value));
      pcm16[index] = value * 32768;
    }

    liveLastProducedAudioAt = new Date().toISOString();
    handleLiveUserAudioActivity(peak);
    window.desktopLive.sendAudioChunk(
      arrayBufferToBase64(pcm16.buffer),
      "audio/pcm;rate=16000"
    );
  };

  liveRecorderGainNode = liveRecorderContext.createGain();
  liveRecorderGainNode.gain.value = 0;
  liveRecorderSource.connect(liveRecorderFallbackNode);
  liveRecorderFallbackNode.connect(liveRecorderGainNode);
  liveRecorderGainNode.connect(liveRecorderContext.destination);
  liveStatusTextEl.textContent = "Microphone connected. Real-time voice input is ready.";
}

function buildConversationKey(item) {
  return `${item.turnId ?? ""}-${item.speaker}-${item.kind ?? "msg"}-${item.createdAt ?? ""}`;
}

function renderConversationFeed(state) {
  const timeline = state.conversationTimeline ?? [];
  const turnsById = new Map(
    (state.conversationTurns ?? []).map((turn) => [turn.turnId, turn])
  );

  // Build a map of existing DOM nodes keyed by data-key
  const existingByKey = new Map();
  for (const child of [...conversationFeedEl.children]) {
    const key = child.dataset?.key;
    if (key) {
      existingByKey.set(key, child);
    }
  }

  if (timeline.length === 0) {
    if (!conversationFeedEl.querySelector(".conversation-empty")) {
      conversationFeedEl.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent =
        "No conversation yet. Speak or type and everything will continue in the same feed.";
      conversationFeedEl.appendChild(empty);
    }
    return;
  }

  // Remove the empty-state placeholder if present
  const emptyEl = conversationFeedEl.querySelector(".conversation-empty");
  if (emptyEl) emptyEl.remove();

  let anchorNode = conversationFeedEl.firstElementChild;
  let shouldScroll = false;

  for (const item of timeline) {
    const key = buildConversationKey(item);
    const turn = turnsById.get(item.turnId);

    const existing = existingByKey.get(key);
    let row = existing;

    if (existing) {
      const previousText =
        existing.querySelector(".message-text")?.textContent ?? "";
      const previousBubbleClass =
        existing.querySelector(".conversation-bubble")?.className ?? "";
      const nextBubbleClass = `conversation-bubble${item.partial ? " partial" : ""}${item.streaming ? " streaming" : ""}${item.interrupted ? " interrupted" : ""}`;

      patchConversationRow(existing, item, turn);
      if (previousText !== item.text || previousBubbleClass !== nextBubbleClass) {
        shouldScroll = true;
      }
      existingByKey.delete(key);
    } else {
      row = createConversationRow(item, turn);
      shouldScroll = true;
    }

    if (row && row !== anchorNode) {
      conversationFeedEl.insertBefore(row, anchorNode);
    }
    anchorNode = row?.nextElementSibling ?? null;
  }

  // Remove stale nodes that are no longer in the timeline
  for (const [, staleNode] of existingByKey) {
    staleNode.remove();
  }

  if (shouldScroll) {
    conversationFeedEl.scrollTop = conversationFeedEl.scrollHeight;
  }
}

function renderTaskWorkspaceHeader(summary) {
  pendingBriefingsCountEl.textContent = `pending briefing ${
    summary.pendingBriefingCount ?? 0
  }`;
}

function renderStackList(container, entries, { emptyText, renderEntry }) {
  container.innerHTML = "";

  if (!entries || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "stack-item";
    renderEntry(item, entry);
    container.appendChild(item);
  }
}

function buildTaskTimelineMap(summary) {
  return new Map(
    (summary.taskTimelines ?? []).map((timeline) => [timeline.taskId, timeline.events])
  );
}

function uniqueNonEmptyLines(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function formatTaskRunnerStatus(status) {
  switch (status) {
    case "created":
    case "queued":
      return "Preparing";
    case "running":
      return "Running";
    case "waiting_input":
      return "Waiting for input";
    case "approval_required":
      return "Waiting for approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function formatVerificationStatus(verification) {
  if (verification === "verified") {
    return "Verified directly";
  }

  if (verification === "uncertain") {
    return "Needs more verification";
  }

  return "No verification details";
}

function parseExecutorDebugDetail(detail) {
  if (typeof detail !== "string" || !detail.trim()) {
    return null;
  }

  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

function getTaskRunnerDetailMap(summary) {
  return new Map(
    (summary.taskRunnerDetails ?? []).map((detail) => [detail.taskId, detail])
  );
}

function buildAdvancedTraceEntries(taskId, selectedRunner) {
  const events = desktopUiState?.debugInspector?.events ?? [];
  const executionPayloadEntries = (selectedRunner?.executionTrace ?? [])
    .filter((entry) => entry.payloadJson && Object.keys(entry.payloadJson).length > 0)
    .map((entry) => ({
      id: `${taskId}:payload:${entry.seq}`,
      kind: `${entry.kind}_payload`,
      createdAt: entry.createdAt,
      body: entry.title,
      meta: JSON.stringify(entry.payloadJson, null, 2)
    }));
  const detailEntries = (selectedRunner?.advancedTrace ?? []).map((entry, index) => ({
    id: `${taskId}:detail:${entry.createdAt}:${index}`,
    kind: entry.kind,
    createdAt: entry.createdAt,
    body: entry.summary,
    meta: entry.detail ?? ""
  }));
  const debugEntries = events
    .filter((event) => event.source === "executor" && event.taskId === taskId)
    .map((event) => {
      const parsed = parseExecutorDebugDetail(event.detail);
      const body =
        parsed?.responseSnippet ??
        parsed?.messageSnippet ??
        parsed?.payloadPreview ??
        event.detail ??
        event.summary;
      const meta = [
        parsed?.name ? `name=${parsed.name}` : null,
        parsed?.status ? `status=${parsed.status}` : null
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        id: event.id,
        kind: event.kind,
        createdAt: event.createdAt,
        body,
        meta
      };
    });

  return [...executionPayloadEntries, ...detailEntries, ...debugEntries].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function getTaskRunnerAccent(status) {
  if (status === "waiting_input" || status === "approval_required") {
    return "waiting";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "completed") {
    return "completed";
  }

  return "running";
}

function getTaskRunnerPriority(status) {
  if (status === "waiting_input" || status === "approval_required") {
    return 0;
  }

  if (status === "running") {
    return 1;
  }

  if (status === "created" || status === "queued") {
    return 2;
  }

  if (status === "completed") {
    return 3;
  }

  return 4;
}

function hydrateTaskRunnerEntry(baseEntry, summary, index = 0) {
  const timelineByTaskId = buildTaskTimelineMap(summary);
  const detailByTaskId = getTaskRunnerDetailMap(summary);
  const activeTasksById = new Map(
    (summary.activeTasks ?? []).map((task) => [task.id, task])
  );
  const task = activeTasksById.get(baseEntry.taskId);
  const detail = detailByTaskId.get(baseEntry.taskId);
  const latestEvent = (timelineByTaskId.get(baseEntry.taskId) ?? []).at(-1);
  const executionTrace = detail?.executionTrace ?? [];
  const advancedTrace = detail?.advancedTrace ?? [];
  const latestExecutionTrace = executionTrace.at(-1) ?? null;

  return {
    ...baseEntry,
    label: baseEntry.label ?? `Task Runner ${index + 1}`,
    title: detail?.title ?? baseEntry.title ?? task?.title ?? "Untitled task",
    headline:
      detail?.headline ??
      baseEntry.headline ??
      baseEntry.title ??
      task?.title ??
      "Untitled task",
    statusLabel:
      detail?.statusLabel ??
      baseEntry.statusLabel ??
      formatTaskRunnerStatus(baseEntry.status),
    heroSummary:
      detail?.heroSummary ??
      baseEntry.latestHumanUpdate ??
      baseEntry.progressSummary ??
      latestEvent?.message ??
      "Summarizing the current progress for this task.",
    latestHumanUpdate:
      detail?.latestHumanUpdate ??
      baseEntry.latestHumanUpdate ??
      baseEntry.progressSummary ??
      latestEvent?.message ??
      "A progress update will appear here shortly.",
    needsUserAction:
      detail?.needsUserAction ??
      baseEntry.needsUserAction ??
      baseEntry.blockingReason ??
      null,
    requestSummary: detail?.requestSummary ?? null,
    timeline: detail?.timeline ?? [],
    resultSummary: detail?.resultSummary ?? task?.completionReport?.summary ?? null,
    detailedAnswer:
      detail?.detailedAnswer ?? task?.completionReport?.detailedAnswer ?? null,
    keyFindings: detail?.keyFindings ?? task?.completionReport?.keyFindings ?? [],
    verification:
      detail?.verification ?? task?.completionReport?.verification ?? null,
    changes: detail?.changes ?? task?.completionReport?.changes ?? [],
    question: detail?.question ?? task?.completionReport?.question ?? null,
    executionTrace,
    advancedTrace,
    traceCount: executionTrace.length + advancedTrace.length,
    timelinePreview:
      detail?.timeline?.at(-1)?.body ??
      detail?.timeline?.at(-1)?.title ??
      latestExecutionTrace?.body ??
      latestExecutionTrace?.title ??
      latestEvent?.message ??
      null,
    latestExecutionTraceTitle: latestExecutionTrace?.title ?? null,
    latestExecutionTraceBody: latestExecutionTrace?.body ?? null,
    lastUpdatedAt:
      detail?.lastUpdatedAt ??
      baseEntry.lastUpdatedAt ??
      latestExecutionTrace?.createdAt ??
      latestEvent?.createdAt ??
      task?.updatedAt ??
      null
  };
}

function sortTaskRunnerEntries(entries) {
  return [...entries].sort((left, right) => {
    const priorityDiff =
      getTaskRunnerPriority(left.status) - getTaskRunnerPriority(right.status);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const leftTime = left.lastUpdatedAt ? new Date(left.lastUpdatedAt).getTime() : 0;
    const rightTime = right.lastUpdatedAt ? new Date(right.lastUpdatedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function sortArchivedTaskEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = left.lastUpdatedAt ? new Date(left.lastUpdatedAt).getTime() : 0;
    const rightTime = right.lastUpdatedAt ? new Date(right.lastUpdatedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function buildTaskRunnerEntries(summary) {
  return sortTaskRunnerEntries(
    (summary.avatar?.taskRunners ?? []).map((runner, index) =>
      hydrateTaskRunnerEntry(runner, summary, index)
    )
  );
}

function buildArchivedTaskEntries(summary) {
  const activeTaskIds = new Set((summary.activeTasks ?? []).map((task) => task.id));

  return sortArchivedTaskEntries(
    (summary.recentTasks ?? [])
      .filter((task) => !activeTaskIds.has(task.id))
      .map((task, index) =>
        hydrateTaskRunnerEntry(
          {
            taskId: task.id,
            label: `Task ${task.id.slice(-4)}`,
            title: task.title,
            status: task.status,
            headline: task.title,
            statusLabel: formatTaskRunnerStatus(task.status),
            latestHumanUpdate:
              task.completionReport?.summary ?? "Open this task to review its logs.",
            lastUpdatedAt: task.updatedAt
          },
          summary,
          index
        )
      )
  );
}

function reconcileSelectedTaskRunner(taskRunners) {
  if (taskRunners.length === 0) {
    selectedTaskRunnerId = null;
    return null;
  }

  if (selectedTaskRunnerId) {
    const existing = taskRunners.find((runner) => runner.taskId === selectedTaskRunnerId);
    if (existing) {
      return existing;
    }
  }

  selectedTaskRunnerId = null;
  return null;
}

function createTaskRunnerTimelineList(entries) {
  const container = document.createElement("div");
  container.className = "task-runner-detail-timeline-list";

  if (!entries || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = "No progress log is available yet.";
    container.appendChild(empty);
    return container;
  }

  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = `task-runner-timeline-item ${entry.emphasis ?? "normal"}`.trim();
    item.innerHTML = `
      <span class="task-runner-timeline-dot" aria-hidden="true"></span>
      <div class="task-runner-timeline-copy">
        <div class="task-runner-timeline-head">
          <p class="task-runner-timeline-title"></p>
          <p class="task-runner-timeline-time"></p>
        </div>
        <p class="task-runner-timeline-body"></p>
      </div>
    `;
    item.querySelector(".task-runner-timeline-title").textContent = entry.title;
    item.querySelector(".task-runner-timeline-time").textContent = formatTime(
      entry.createdAt
    );
    item.querySelector(".task-runner-timeline-body").textContent = entry.body;
    container.appendChild(item);
  }

  return container;
}

function buildTaskRunnerDisplayTimeline(selectedRunner) {
  const baseEntries = [...(selectedRunner.timeline ?? [])];
  const executionTraceEntries = (selectedRunner.executionTrace ?? []).map((entry) => ({
    kind:
      entry.kind === "error"
        ? "failure"
        : entry.kind === "tool_use" || entry.kind === "tool_result" || entry.kind === "message"
          ? "progress_update"
          : entry.kind === "result"
            ? "completion_received"
            : "progress_update",
    title:
      entry.kind === "tool_use" || entry.kind === "tool_result"
        ? entry.title
        : entry.kind === "message"
          ? "Executor note"
          : entry.title,
    body:
      entry.body ??
      entry.detail ??
      entry.title,
    createdAt: entry.createdAt,
    emphasis:
      entry.kind === "error"
        ? "error"
        : entry.kind === "result"
          ? "success"
          : "info",
    source: "executor"
  }));
  const summary = getTaskSummary();
  const notifications = [
    ...(summary.notifications?.delivered ?? []),
    ...(summary.notifications?.pending ?? [])
  ]
    .filter((plan) => plan?.taskId === selectedRunner.taskId && plan.uiText)
    .map((plan) => ({
      kind:
        plan.reason === "approval_required"
          ? "needs_approval"
          : plan.reason === "task_waiting_input"
            ? "needs_input"
            : plan.reason === "task_failed"
              ? "failure"
              : plan.reason === "task_completed"
                ? "completion_received"
                : "progress_update",
      title:
        plan.reason === "approval_required"
          ? "Runtime asked for approval"
          : plan.reason === "task_waiting_input"
            ? "Runtime asked for more input"
            : plan.reason === "task_failed"
              ? "Runtime reported a blocker"
              : plan.reason === "task_completed"
                ? "Runtime completion briefing"
                : "Runtime note",
      body: plan.uiText,
      createdAt: plan.createdAt ?? selectedRunner.lastUpdatedAt ?? new Date().toISOString(),
      emphasis:
        plan.reason === "task_failed"
          ? "error"
          : plan.reason === "approval_required" || plan.reason === "task_waiting_input"
            ? "warning"
            : plan.reason === "task_completed"
              ? "success"
              : "info",
      source: "system"
    }));

  const runtimeEvents = (desktopUiState?.debugInspector?.events ?? [])
    .filter((event) => event.source === "runtime" && event.taskId === selectedRunner.taskId)
    .map((event) => ({
      kind:
        event.kind === "task_intake"
          ? "needs_input"
          : selectedRunner.status === "failed"
            ? "failure"
            : "progress_update",
      title:
        event.kind === "task_intake"
          ? "Runtime clarification"
          : "Runtime note",
      body: event.summary,
      createdAt: event.createdAt,
      emphasis:
        event.kind === "task_intake"
          ? "warning"
          : "info",
      source: "system"
    }));

  const merged = [...baseEntries, ...executionTraceEntries, ...notifications, ...runtimeEvents]
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    )
    .filter((entry, index, list) => {
      const previous = list[index - 1];
      return !(
        previous &&
        previous.kind === entry.kind &&
        previous.title === entry.title &&
        previous.body === entry.body &&
        previous.createdAt === entry.createdAt
      );
    });

  return merged;
}

function createAdvancedTraceList(selectedRunner) {
  const executionTrace = buildAdvancedTraceEntries(selectedRunner.taskId, selectedRunner);
  const list = document.createElement("div");
  list.className = "task-runner-detail-execution-list";

  if (executionTrace.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = "No advanced execution trace is available yet.";
    list.appendChild(empty);
    return list;
  }

  for (const entry of executionTrace) {
    const item = document.createElement("article");
    item.className = "task-runner-detail-event";
    item.innerHTML = `
      <div class="task-runner-detail-event-head">
        <p class="task-runner-detail-event-kind"></p>
        <p class="task-runner-detail-event-time"></p>
      </div>
      <p class="task-runner-detail-event-text"></p>
      <pre class="task-runner-detail-event-meta"></pre>
    `;
    item.querySelector(".task-runner-detail-event-kind").textContent =
      entry.kind.replaceAll("_", " ");
    item.querySelector(".task-runner-detail-event-time").textContent = formatTime(
      entry.createdAt
    );
    item.querySelector(".task-runner-detail-event-text").textContent =
      entry.body ?? "No execution detail";
    const metaEl = item.querySelector(".task-runner-detail-event-meta");
    if (entry.meta) {
      metaEl.textContent = entry.meta;
    } else {
      metaEl.remove();
    }
    list.appendChild(item);
  }

  return list;
}

function createTaskExecutionTraceList(selectedRunner) {
  const entries = selectedRunner.executionTrace ?? [];
  const list = document.createElement("div");
  list.className = "task-runner-trace-list";

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = "No saved execution trace is available yet.";
    list.appendChild(empty);
    return list;
  }

  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "task-runner-trace-card";
    item.innerHTML = `
      <div class="task-runner-trace-head">
        <div class="task-runner-trace-head-copy">
          <p class="task-runner-trace-title"></p>
          <p class="task-runner-trace-time"></p>
        </div>
        <div class="task-runner-trace-badges">
          <span class="task-runner-trace-kind"></span>
          <span class="task-runner-trace-status"></span>
        </div>
      </div>
      <p class="task-runner-trace-body"></p>
      <p class="task-runner-trace-meta"></p>
    `;
    item.querySelector(".task-runner-trace-title").textContent = entry.title;
    item.querySelector(".task-runner-trace-time").textContent = formatTime(entry.createdAt);
    item.querySelector(".task-runner-trace-kind").textContent =
      entry.kind.replaceAll("_", " ");
    const statusEl = item.querySelector(".task-runner-trace-status");
    if (entry.status) {
      statusEl.textContent = entry.status;
    } else {
      statusEl.remove();
    }
    const bodyEl = item.querySelector(".task-runner-trace-body");
    if (entry.body) {
      bodyEl.textContent = entry.body;
    } else {
      bodyEl.remove();
    }
    const metaBits = [
      entry.toolName ? `tool=${entry.toolName}` : null,
      entry.role ? `role=${entry.role}` : null,
      typeof entry.seq === "number" ? `step=${entry.seq + 1}` : null
    ].filter(Boolean);
    const metaEl = item.querySelector(".task-runner-trace-meta");
    if (entry.detail || metaBits.length > 0) {
      metaEl.textContent = [metaBits.join(" · "), entry.detail ?? null]
        .filter(Boolean)
        .join(" · ");
    } else {
      metaEl.remove();
    }
    if (entry.payloadJson && Object.keys(entry.payloadJson).length > 0) {
      const raw = document.createElement("details");
      raw.className = "task-runner-trace-payload";
      raw.innerHTML = "<summary>Raw payload</summary>";
      const payload = document.createElement("pre");
      payload.className = "task-runner-trace-payload-pre";
      payload.textContent = JSON.stringify(entry.payloadJson, null, 2);
      raw.appendChild(payload);
      item.appendChild(raw);
    }
    list.appendChild(item);
  }

  return list;
}

function createTaskRunnerDetailContent(selectedRunner) {
  const detail = document.createElement("div");
  detail.className = "task-runner-card-detail";

  const updatedAtText = selectedRunner.lastUpdatedAt
    ? `Last updated · ${formatTime(selectedRunner.lastUpdatedAt)}`
    : "";

  detail.innerHTML = `
    <div class="task-runner-detail-head">
      <div class="task-runner-detail-head-copy">
        <div class="task-runner-detail-head-top">
          <p class="message-role">${selectedRunner.label}</p>
          <span class="task-runner-status-pill ${getTaskRunnerAccent(selectedRunner.status)}">
            ${selectedRunner.statusLabel ?? formatTaskRunnerStatus(selectedRunner.status)}
          </span>
        </div>
        <h4 class="task-runner-detail-title">${selectedRunner.headline}</h4>
        <p class="stack-text">${selectedRunner.heroSummary}</p>
      </div>
    </div>
  `;

  if (selectedRunner.needsUserAction) {
    const callout = document.createElement("div");
    callout.className = "task-runner-detail-callout";
    callout.innerHTML = `
      <p class="stack-subtitle">Needs Attention</p>
      <p class="stack-text">${selectedRunner.needsUserAction}</p>
    `;
    detail.appendChild(callout);
  }

  if (selectedRunner.status !== "completed" && (selectedRunner.executionTrace?.length ?? 0) > 0) {
    const liveExecution = document.createElement("div");
    liveExecution.className = "task-runner-detail-section";
    liveExecution.innerHTML = `
      <div class="task-runner-detail-section-head">
        <p class="stack-subtitle">Live Execution Feed</p>
        <p class="stack-subtitle">${
          selectedRunner.executionTrace?.length ?? 0
        } saved events</p>
      </div>
    `;
    liveExecution.appendChild(createTaskExecutionTraceList(selectedRunner));
    detail.appendChild(liveExecution);
  }

  const timelineSection = document.createElement("div");
  timelineSection.className = "task-runner-detail-section";
  timelineSection.innerHTML = `
    <div class="task-runner-detail-section-head">
      <p class="stack-subtitle">Progress Log</p>
      <p class="stack-subtitle">${updatedAtText}</p>
    </div>
  `;
  timelineSection.appendChild(
    createTaskRunnerTimelineList(buildTaskRunnerDisplayTimeline(selectedRunner))
  );
  detail.appendChild(timelineSection);

  if (selectedRunner.detailedAnswer) {
    const answer = document.createElement("div");
    answer.className = "task-runner-detail-section";
    answer.innerHTML = `
      <div class="task-runner-detail-section-head">
        <p class="stack-subtitle">Full Answer</p>
      </div>
      <article class="task-runner-detail-answer-card">
        <p class="stack-text"></p>
      </article>
    `;
    answer.querySelector(".stack-text").textContent = selectedRunner.detailedAnswer;
    detail.appendChild(answer);
  }

  if ((selectedRunner.keyFindings?.length ?? 0) > 0) {
    const findings = document.createElement("div");
    findings.className = "task-runner-detail-section";
    findings.innerHTML = `
      <div class="task-runner-detail-section-head">
        <p class="stack-subtitle">Key Findings</p>
      </div>
      <div class="task-runner-key-findings"></div>
    `;
    const findingsList = findings.querySelector(".task-runner-key-findings");
    for (const finding of selectedRunner.keyFindings) {
      const chip = document.createElement("article");
      chip.className = "task-runner-key-finding";
      chip.textContent = finding;
      findingsList.appendChild(chip);
    }
    detail.appendChild(findings);
  }

  const hasResult =
    Boolean(selectedRunner.resultSummary) ||
    Boolean(selectedRunner.verification) ||
    (selectedRunner.changes?.length ?? 0) > 0;
  if (hasResult) {
    const result = document.createElement("div");
    result.className = "task-runner-detail-result";
    result.innerHTML = `
      <p class="stack-subtitle">Result</p>
      <div class="task-runner-detail-result-grid">
        <article class="task-runner-detail-result-card">
          <p class="task-runner-detail-result-label">What Changed</p>
          <p class="task-runner-detail-result-text">${
            selectedRunner.resultSummary ?? "No result summary yet."
          }</p>
        </article>
        <article class="task-runner-detail-result-card">
          <p class="task-runner-detail-result-label">Confidence</p>
          <p class="task-runner-detail-result-text">${formatVerificationStatus(
            selectedRunner.verification
          )}</p>
        </article>
      </div>
    `;

    if ((selectedRunner.changes?.length ?? 0) > 0) {
      const changes = document.createElement("div");
      changes.className = "task-runner-detail-result-card";
      changes.innerHTML = `
        <p class="task-runner-detail-result-label">Changes</p>
        <ul class="task-runner-detail-change-list"></ul>
      `;
      const list = changes.querySelector(".task-runner-detail-change-list");
      for (const change of selectedRunner.changes) {
        const item = document.createElement("li");
        item.textContent = change;
        list.appendChild(item);
      }
      result.appendChild(changes);
    }

    detail.appendChild(result);
  }

  const executionSection = document.createElement("div");
  executionSection.className = "task-runner-detail-section";
  executionSection.innerHTML = `
    <div class="task-runner-detail-section-head">
      <p class="stack-subtitle">Execution Trace</p>
      <p class="stack-subtitle">${
        selectedRunner.executionTrace?.length ?? 0
      } saved events</p>
    </div>
  `;
  executionSection.appendChild(createTaskExecutionTraceList(selectedRunner));
  detail.appendChild(executionSection);

  const advanced = document.createElement("details");
  advanced.className = "task-runner-detail-advanced";
  advanced.innerHTML = `
    <summary>Advanced Details</summary>
    <div class="task-runner-detail-advanced-copy">
      <p class="stack-subtitle">taskId · ${selectedRunner.taskId}</p>
    </div>
  `;
  if (selectedRunner.requestSummary) {
    const request = document.createElement("p");
    request.className = "stack-text";
    request.textContent = `Request summary · ${selectedRunner.requestSummary}`;
    advanced.querySelector(".task-runner-detail-advanced-copy").appendChild(request);
  }
  const execution = document.createElement("div");
  execution.className = "task-runner-detail-execution";
  execution.innerHTML = `<p class="stack-subtitle">execution trace</p>`;
  execution.appendChild(createAdvancedTraceList(selectedRunner));
  advanced.appendChild(execution);
  detail.appendChild(advanced);

  return detail;
}

function createTaskRunnerShell() {
  const shell = document.createElement("article");
  const card = document.createElement("button");
  card.type = "button";
  card.innerHTML = `
    <span class="task-runner-avatar" aria-hidden="true">
      <span class="task-runner-avatar-core"></span>
    </span>
    <span class="task-runner-copy">
      <span class="task-runner-title"></span>
      <span class="task-runner-meta-row">
        <span class="task-runner-pill"></span>
        <span class="task-runner-update"></span>
      </span>
      <span class="task-runner-supporting"></span>
    </span>
  `;
  shell.appendChild(card);
  return shell;
}

function patchTaskRunnerShell(shell, runner, selected) {
  const accent = getTaskRunnerAccent(runner.status);
  shell.className = `task-runner-card-shell ${accent}${selected ? " selected" : ""}`;
  shell.dataset.taskId = runner.taskId;

  const card = shell.querySelector(".task-runner-card") ?? shell.firstElementChild;
  card.className = `task-runner-card ${accent}${selected ? " selected" : ""}`;
  card.setAttribute("aria-expanded", selected ? "true" : "false");
  card.onclick = () => {
    selectedTaskRunnerId = selectedTaskRunnerId === runner.taskId ? null : runner.taskId;
    renderTaskRunnerCards();
    renderTaskLists();
  };

  const runnerPill = card.querySelector(".task-runner-pill");
  runnerPill.textContent = runner.statusLabel ?? formatTaskRunnerStatus(runner.status);
  runnerPill.className = `task-runner-pill ${accent}`;
  card.querySelector(".task-runner-title").textContent = runner.headline;
  card.querySelector(".task-runner-update").textContent = runner.latestHumanUpdate;
  const supporting = card.querySelector(".task-runner-supporting");
  const supportingParts = [
    runner.latestExecutionTraceTitle
      ? `${runner.latestExecutionTraceTitle}${
          runner.latestExecutionTraceBody ? ` · ${runner.latestExecutionTraceBody}` : ""
        }`
      : runner.timelinePreview,
    typeof runner.traceCount === "number" && runner.traceCount > 0
      ? `${runner.traceCount} saved trace item${runner.traceCount === 1 ? "" : "s"}`
      : null,
    runner.lastUpdatedAt ? `Updated ${formatTime(runner.lastUpdatedAt)}` : null
  ].filter(Boolean);
  supporting.textContent = supportingParts.join(" · ");
  supporting.hidden = supportingParts.length === 0;

  const existingDetail = shell.querySelector(".task-runner-card-detail");
  if (selected) {
    const nextDetail = createTaskRunnerDetailContent(runner);
    if (existingDetail) {
      existingDetail.replaceWith(nextDetail);
    } else {
      shell.appendChild(nextDetail);
    }
  } else if (existingDetail) {
    existingDetail.remove();
  }
}

function renderTaskRunnerCardList(container, entries, emptyText) {
  const existingByTaskId = new Map();
  for (const child of [...container.children]) {
    const taskId = child.dataset?.taskId;
    if (taskId) {
      existingByTaskId.set(taskId, child);
    }
  }

  const existingEmpty = container.querySelector(".stack-empty");
  if (!entries || entries.length === 0) {
    for (const [, node] of existingByTaskId) {
      node.remove();
    }
    if (existingEmpty) {
      existingEmpty.textContent = emptyText;
      return;
    }
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = emptyText;
    container.replaceChildren(empty);
    return;
  }

  if (existingEmpty) {
    existingEmpty.remove();
  }

  let anchorNode = container.firstElementChild;
  for (const runner of entries) {
    const selected = runner.taskId === selectedTaskRunnerId;
    const existingShell = existingByTaskId.get(runner.taskId);
    const shell = existingShell ?? createTaskRunnerShell();

    patchTaskRunnerShell(shell, runner, selected);
    existingByTaskId.delete(runner.taskId);

    if (shell !== anchorNode) {
      container.insertBefore(shell, anchorNode);
    }
    anchorNode = shell.nextElementSibling;
  }

  for (const [, staleNode] of existingByTaskId) {
    staleNode.remove();
  }
}

function renderTaskRunnerCards() {
  const summary = getTaskSummary();
  const taskRunners = buildTaskRunnerEntries(summary);
  const archivedEntries = buildArchivedTaskEntries(summary);
  reconcileSelectedTaskRunner([...taskRunners, ...archivedEntries]);

  renderTaskRunnerCardList(
    taskRunnerListEl,
    taskRunners,
    "There is no active task runner right now."
  );
}

function renderTaskLists() {
  const summary = getTaskSummary();
  const archivedEntries = buildArchivedTaskEntries(summary);

  taskDrawerCountEl.textContent = `${archivedEntries.length} items`;
  taskDrawerDescriptionEl.textContent =
    archivedEntries.length > 0
      ? "Finished tasks stay here as scrollable cards, ready to reopen with full detail."
      : "Finished tasks will move here once they are done.";
  taskDrawerDescriptionEl.className =
    archivedEntries.length > 0 ? "summary-detail" : "summary-detail empty-state";

  renderTaskRunnerCardList(
    taskDrawerListEl,
    archivedEntries,
    "There are no archived tasks in the drawer yet."
  );
}

function buildHistoryEntries(historySummary) {
  return (historySummary.sessions ?? []).map((session) => {
    const latestTask = (session.recentTasks ?? [])[0];
    const primaryText =
      session.lastAssistantMessage ??
      session.lastUserMessage ??
      latestTask?.summary ??
      "No saved conversation preview.";
    const taskSummary =
      (session.recentTasks ?? []).length > 0
        ? (session.recentTasks ?? [])
            .map((task) =>
              [task.title, task.status, task.summary ?? null].filter(Boolean).join(" · ")
            )
            .join(" | ")
        : "No saved tasks.";

    return {
      id: session.brainSessionId,
      title: session.brainSessionId,
      subtitle: [
        session.source ?? "live",
        session.status ?? "unknown",
        session.updatedAt ? formatTime(session.updatedAt) : null
      ]
        .filter(Boolean)
        .join(" · "),
      text: primaryText,
      meta: taskSummary
    };
  });
}

function renderHistoryList() {
  const historySummary = getHistorySummary();
  const historyEntries = buildHistoryEntries(historySummary);

  historyRefreshButtonEl.disabled = historySummary.loading;
  historyRefreshButtonEl.textContent = historySummary.loading
    ? "Refreshing…"
    : "Refresh";
  historyDrawerCountEl.textContent = `${historyEntries.length} sessions`;

  if (historySummary.error) {
    historyDrawerDescriptionEl.textContent = `history error · ${historySummary.error}`;
    historyDrawerDescriptionEl.className = "summary-detail";
  } else if (historySummary.loading) {
    historyDrawerDescriptionEl.textContent = "Loading saved session summaries.";
    historyDrawerDescriptionEl.className = "summary-detail";
  } else if (historyEntries.length > 0) {
    historyDrawerDescriptionEl.textContent =
      "These are the saved sessions and task summaries for the current judge user.";
    historyDrawerDescriptionEl.className = "summary-detail";
  } else {
    historyDrawerDescriptionEl.textContent = "No saved session summaries.";
    historyDrawerDescriptionEl.className = "summary-detail empty-state";
  }

  renderStackList(historyDrawerListEl, historyEntries, {
    emptyText: "No saved sessions.",
    renderEntry(item, entry) {
      item.innerHTML = `
        <p class="stack-title"></p>
        <p class="stack-subtitle"></p>
        <p class="stack-text"></p>
        <p class="stack-meta"></p>
      `;
      item.querySelector(".stack-title").textContent = entry.title;
      item.querySelector(".stack-subtitle").textContent = entry.subtitle;
      item.querySelector(".stack-text").textContent = entry.text;
      item.querySelector(".stack-meta").textContent = entry.meta ?? "";
    }
  });
}

function renderDebugInspector(state) {
  const events = state.debugInspector?.events ?? [];
  const turnFilter = debugTurnFilterEl.value.trim();
  const taskFilter = debugTaskFilterEl.value.trim();
  const filteredEvents = events.filter((event) => {
    if (!debugSourceFilters.has(event.source)) {
      return false;
    }
    if (turnFilter && !(event.turnId ?? "").includes(turnFilter)) {
      return false;
    }
    if (taskFilter && !(event.taskId ?? "").includes(taskFilter)) {
      return false;
    }
    return true;
  });

  debugEventListEl.innerHTML = "";

  if (filteredEvents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = "No debug events match the current filters.";
    debugEventListEl.appendChild(empty);
    return;
  }

  for (const event of filteredEvents) {
    const item = document.createElement("article");
    item.className = "debug-event";
    item.innerHTML = `
      <div class="debug-meta">
        <span class="source-badge"></span>
        <span class="bubble-status"></span>
        <span class="bubble-status"></span>
      </div>
      <p class="debug-summary"></p>
      <p class="debug-detail"></p>
    `;
    const badges = item.querySelectorAll(".bubble-status");
    item.querySelector(".source-badge").textContent = event.source;
    badges[0].textContent = event.kind;
    badges[1].textContent = formatTime(event.createdAt);
    item.querySelector(".debug-summary").textContent = event.summary;
    item.querySelector(".debug-detail").textContent = [
      event.turnId ? `turn=${event.turnId}` : null,
      event.taskId ? `task=${event.taskId}` : null,
      event.detail ?? null
    ]
      .filter(Boolean)
      .join(" · ");
    debugEventListEl.appendChild(item);
  }
}

function performUiRender(nextState) {
  const previousVoiceState = getVoiceState();
  desktopUiState = nextState;
  const voiceState = getVoiceState();
  const inputState = desktopUiState.inputState ?? {};
  const summary = getTaskSummary();
  const historySummary = getHistorySummary();
  const debugInspector = desktopUiState.debugInspector ?? { events: [] };

  const becameInterrupted =
    previousVoiceState.status !== "interrupted" &&
    voiceState.status === "interrupted";
  const disconnectedWhilePlaying =
    previousVoiceState.connected &&
    !voiceState.connected;
  if (becameInterrupted || disconnectedWhilePlaying) {
    stopPlayback();
  }

  const chromeSignature = buildChromeSignature(desktopUiState, voiceState, inputState);
  if (renderStateCache.chrome !== chromeSignature) {
    renderStateCache.chrome = chromeSignature;

    runtimeMetaEl.textContent = `session=${desktopUiState.brainSessionId ?? "n/a"}`;
    executorBadgeEl.textContent = `executor=${desktopUiState.executionMode ?? "unknown"}`;
    executorBadgeEl.className = `executor-badge ${
      desktopUiState.executionMode ?? ""
    }`.trim();
    inputStatusEl.textContent = inputState.inFlight
      ? `working: ${inputState.activeText ?? ""}`
      : "idle";
    micStateEl.textContent = voiceState.mic?.mode ?? "idle";
    micToggleEl.textContent = voiceState.mic?.enabled ? "Mic On" : "Mic Off";
    userSpeakingStateEl.textContent = voiceState.activity?.userSpeaking
      ? "User Speaking"
      : "User Idle";
    assistantSpeakingStateEl.textContent = voiceState.activity?.assistantSpeaking
      ? "Assistant Speaking"
      : "Assistant Idle";

    liveStatusBadgeEl.textContent = voiceState.status ?? "idle";
    liveStatusBadgeEl.className = `executor-badge ${
      voiceState.connected ? "gemini" : ""
    }`.trim();
    liveStatusTextEl.textContent = voiceState.error
      ? `voice error: ${voiceState.error}`
      : voiceState.connecting
        ? "Connecting to Gemini Live…"
        : voiceState.connected
          ? "READY to listen and respond in real time."
          : "Live conversation has not started yet.";

    liveConnectButtonEl.disabled = voiceState.connected || voiceState.connecting;
    liveMuteButtonEl.disabled = !voiceState.connected;
    liveHangupButtonEl.disabled = !voiceState.connected && !voiceState.connecting;
    liveMuteButtonEl.textContent = voiceState.muted ? "Unmute" : "Mute";
    if (livePasscodeEl) {
      livePasscodeEl.disabled = voiceState.connecting;
    }

    if (desktopUiState.runtimeError) {
      showRuntimeError(desktopUiState.runtimeError);
    } else {
      hideRuntimeError();
    }

    const liveAvatarEl = document.getElementById("live-avatar");
    if (liveAvatarEl) {
      const isSpeaking =
        voiceState.activity?.assistantSpeaking || voiceState.activity?.userSpeaking;
      liveAvatarEl.classList.toggle("speaking", !!isSpeaking);
    }
  }

  const conversationSignature = buildConversationSignature(desktopUiState);
  if (renderStateCache.conversation !== conversationSignature) {
    renderStateCache.conversation = conversationSignature;
    renderConversationFeed(desktopUiState);
  }

  const summarySignature = buildSummarySignature(summary, voiceState);
  if (renderStateCache.summary !== summarySignature) {
    renderStateCache.summary = summarySignature;
    renderTaskWorkspaceHeader(summary);
  }

  const taskRunnerSignature = buildTaskRunnerSignature(summary, debugInspector);
  if (renderStateCache.taskRunners !== taskRunnerSignature) {
    renderStateCache.taskRunners = taskRunnerSignature;
    renderTaskRunnerCards();
  }

  const taskDrawerSignature = buildTaskDrawerSignature(summary);
  if (renderStateCache.taskDrawer !== taskDrawerSignature) {
    renderStateCache.taskDrawer = taskDrawerSignature;
    renderTaskLists();
  }

  const historySignature = buildHistorySignature(historySummary);
  if (renderStateCache.historyDrawer !== historySignature) {
    renderStateCache.historyDrawer = historySignature;
    renderHistoryList();
  }

  const debugSignature = buildDebugSignature(debugInspector);
  if (renderStateCache.debugInspector !== debugSignature) {
    renderStateCache.debugInspector = debugSignature;
    renderDebugInspector(desktopUiState);
  }
}

function renderUiState(nextState) {
  scheduledUiState = nextState;
  if (scheduledRenderFrame !== null) {
    return;
  }

  scheduledRenderFrame = window.requestAnimationFrame(() => {
    scheduledRenderFrame = null;
    const stateToRender = scheduledUiState;
    scheduledUiState = null;
    if (stateToRender) {
      performUiRender(stateToRender);
    }
  });
}

async function bootstrap() {
  if (!window.desktopUi || typeof window.desktopUi.init !== "function") {
    throw new Error("desktopUi bridge is not available. Check preload setup.");
  }

  const state = await window.desktopUi.init();
  renderUiState(state);

  window.desktopUi.onStateUpdated((nextState) => {
    renderUiState(nextState);
  });
  window.desktopLive.onAudioChunk((chunk) => {
    void handleAudioChunk(chunk);
  });

  await populateMicrophones();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    void populateMicrophones().catch(showRuntimeError);
  });
}

composerEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (promptComposing) {
    return;
  }
  const text = promptEl.value.trim();
  if (!text) {
    return;
  }

  try {
    promptEl.value = "";
    await window.desktopCompanion.sendTypedTurn(text);
  } catch (error) {
    showRuntimeError(error);
  }
});

promptEl.addEventListener("compositionstart", () => {
  promptComposing = true;
});

promptEl.addEventListener("compositionend", () => {
  promptComposing = false;
});

micToggleEl.addEventListener("click", async () => {
  try {
    await window.desktopSession.toggleMic();
  } catch (error) {
    showRuntimeError(error);
  }
});

liveConnectButtonEl.addEventListener("click", async () => {
  try {
    hideRuntimeError();
    stopPlayback();
    liveLastProducedAudioAt = null;
    const passcode = livePasscodeEl?.value?.trim?.() ?? "";
    await window.desktopLive.connect(passcode);
    await startVoiceCapture();
  } catch (error) {
    showRuntimeError(error);
    await stopVoiceCapture().catch(() => undefined);
    await window.desktopLive.disconnect().catch(() => undefined);
  }
});

liveMuteButtonEl.addEventListener("click", async () => {
  try {
    const nextMuted = !getVoiceState().muted;
    if (liveRecorderStream) {
      for (const track of liveRecorderStream.getAudioTracks()) {
        track.enabled = !nextMuted;
      }
      if (nextMuted) {
        liveUserSpeakingActive = false;
        liveSpeechCandidateStartAt = 0;
        clearTimeout(liveUserSpeakingTimer);
        await window.desktopLive.endAudioStream().catch(() => undefined);
      }
      liveUserSpeakingActive = !nextMuted && liveUserSpeakingActive;
      await setRuntimeUserSpeaking(!nextMuted && liveUserSpeakingActive);
    }

    await window.desktopLive.setMuted(nextMuted);
  } catch (error) {
    showRuntimeError(error);
  }
});

liveHangupButtonEl.addEventListener("click", async () => {
  try {
    await stopVoiceCapture();
    stopPlayback();
    await setRuntimeAssistantSpeaking(false);
    await window.desktopLive.disconnect();
  } catch (error) {
    showRuntimeError(error);
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !promptComposing
  ) {
    event.preventDefault();
    composerEl.requestSubmit();
  }
});

debugSourceFilterEls.forEach((element) => {
  element.addEventListener("change", () => {
    const source = element.dataset.sourceFilter;
    if (!source) {
      return;
    }
    if (element.checked) {
      debugSourceFilters.add(source);
    } else {
      debugSourceFilters.delete(source);
    }
    if (desktopUiState) {
      renderDebugInspector(desktopUiState);
    }
  });
});

debugTurnFilterEl.addEventListener("input", () => {
  if (desktopUiState) {
    renderDebugInspector(desktopUiState);
  }
});

debugTaskFilterEl.addEventListener("input", () => {
  if (desktopUiState) {
    renderDebugInspector(desktopUiState);
  }
});

historyRefreshButtonEl.addEventListener("click", async () => {
  try {
    hideRuntimeError();
    await window.desktopUi.refreshHistory();
  } catch (error) {
    showRuntimeError(error);
  }
});

bootstrap().catch((error) => {
  console.error(error);
  showRuntimeError(error);
});
