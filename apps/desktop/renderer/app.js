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
const liveMicSelectEl = document.getElementById("live-mic-select");
const pendingBriefingsCountEl = document.getElementById(
  "pending-briefings-count"
);
const mainAvatarStateEl = document.getElementById("main-avatar-state");
const workspaceStatePillEl = document.getElementById("workspace-state-pill");
const liveRouteSummaryEl = document.getElementById("live-route-summary");
const liveRouteDetailEl = document.getElementById("live-route-detail");
const voiceIntakeSummaryEl = document.getElementById("voice-intake-summary");
const taskRunnerListEl = document.getElementById("task-runner-list");
const taskRunnerDetailCardEl = document.getElementById(
  "task-runner-detail-card"
);
const taskRunnerDetailLabelEl = document.getElementById(
  "task-runner-detail-label"
);
const taskRunnerDetailTitleEl = document.getElementById(
  "task-runner-detail-title"
);
const taskRunnerDetailStatusEl = document.getElementById(
  "task-runner-detail-status"
);
const taskRunnerDetailIdEl = document.getElementById("task-runner-detail-id");
const taskRunnerDetailUpdateEl = document.getElementById(
  "task-runner-detail-update"
);
const taskRunnerDetailBlockingEl = document.getElementById(
  "task-runner-detail-blocking"
);
const taskRunnerDetailUpdatedAtEl = document.getElementById(
  "task-runner-detail-updated-at"
);
const taskRunnerDetailSummaryEl = document.getElementById(
  "task-runner-detail-summary"
);
const taskDrawerCountEl = document.getElementById("task-drawer-count");
const taskDrawerDescriptionEl = document.getElementById(
  "task-drawer-description"
);
const taskDrawerListEl = document.getElementById("task-drawer-list");
const debugEventListEl = document.getElementById("debug-event-list");
const debugTurnFilterEl = document.getElementById("debug-turn-filter");
const debugTaskFilterEl = document.getElementById("debug-task-filter");
const debugSourceFilterEls = [
  ...document.querySelectorAll("[data-source-filter]")
];

const debugSourceFilters = new Set(
  debugSourceFilterEls.map((element) => element.dataset.sourceFilter)
);
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
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
let liveLastProducedAudioAt = null;
let liveUserSpeakingTimer;
let liveUserSpeakingActive = false;
let liveSpeechCandidateStartAt = 0;
let promptComposing = false;
let selectedTaskRunnerId = null;
const activeAudioSources = [];
const LIVE_INPUT_BUFFER_SIZE = 512;
const LIVE_SPEECH_ACTIVITY_THRESHOLD = 0.03;
const LIVE_SPEECH_IDLE_MS = 320;
const LIVE_BARGE_IN_CONFIRM_MS = 140;

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
      intake: { active: false, missingSlots: [], lastQuestion: null, workingText: "" },
      avatar: { mainState: "idle", taskRunners: [] },
      notifications: { pending: [], delivered: [] },
      pendingBriefingCount: 0
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
  liveAudioQueue.push(base64ToFloat32AudioData(chunk.data));
  await playQueuedAudio();
}

async function populateMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    liveStatusTextEl.textContent = "이 환경에서는 microphone device 조회를 지원하지 않습니다.";
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
    throw new Error("이 환경에서는 getUserMedia를 사용할 수 없습니다.");
  }

  const deviceId = liveMicSelectEl.value;
  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true
  };
  liveStatusTextEl.textContent = "microphone 권한을 요청하는 중…";
  liveRecorderStream = await navigator.mediaDevices.getUserMedia(constraints);
  liveStatusTextEl.textContent = "microphone 연결 완료. Gemini Live에 연결 중…";
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
  liveStatusTextEl.textContent = "microphone 연결 완료. 실시간 음성 입력 준비가 끝났습니다.";
}

function renderConversationFeed(state) {
  const timeline = state.conversationTimeline ?? [];
  const turnsById = new Map(
    (state.conversationTurns ?? []).map((turn) => [turn.turnId, turn])
  );

  conversationFeedEl.innerHTML = "";

  if (timeline.length === 0) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent =
      "아직 대화가 없습니다. 음성으로 말하거나 텍스트를 입력하면 같은 피드에 이어집니다.";
    conversationFeedEl.appendChild(empty);
    return;
  }

  for (const item of timeline) {
    const row = document.createElement("article");
    row.className = `conversation-row ${item.speaker}`;

    const bubble = document.createElement("div");
    bubble.className = `conversation-bubble${
      item.partial ? " partial" : ""
    }${item.streaming ? " streaming" : ""}${
      item.interrupted ? " interrupted" : ""
    }`;

    const meta = document.createElement("div");
    meta.className = "conversation-meta";

    const role = document.createElement("p");
    role.className = "message-role";
    role.textContent =
      item.kind === "task_event"
        ? "task event"
        : item.speaker === "user"
          ? "you"
          : item.responseSource
            ? `assistant · ${item.responseSource}`
            : "assistant";
    meta.appendChild(role);

    const modeChip = document.createElement("span");
    modeChip.className = "turn-chip";
    modeChip.textContent = item.inputMode;
    meta.appendChild(modeChip);

    const turn = turnsById.get(item.turnId);
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
    conversationFeedEl.appendChild(row);
  }

  conversationFeedEl.scrollTop = conversationFeedEl.scrollHeight;
}

function renderSummaryCardState(state) {
  const summary = getTaskSummary();
  const voiceState = getVoiceState();
  const activeRunnerCount = summary.avatar?.taskRunners?.length ?? 0;
  const latestBlockingTask = (summary.activeTasks ?? []).find(
    (task) =>
      task.status === "waiting_input" || task.status === "approval_required"
  );

  let companionStateText = "대기 중";
  let companionRouteText = "아직 확인 중인 요청이 없습니다.";
  let companionIntakeText = "지금 보충 질문 중인 작업이 없습니다.";

  if (summary.intake?.active) {
    companionStateText = "입력 대기 중";
    companionRouteText = "작업을 시작하기 전에 필요한 정보를 모으고 있습니다.";
    const missing = (summary.intake.missingSlots ?? []).join(", ");
    companionIntakeText = missing
      ? `${summary.intake.workingText} · missing: ${missing}`
      : summary.intake.workingText;
  } else if (latestBlockingTask) {
    companionStateText = "확인 필요";
    companionRouteText = "진행 중인 작업이 사용자 입력 또는 승인을 기다리고 있습니다.";
    companionIntakeText = latestBlockingTask.title;
  } else if (activeRunnerCount > 0) {
    companionStateText = `${activeRunnerCount}개 작업 진행 중`;
    companionRouteText =
      voiceState.routing?.summary ?? "백그라운드에서 task runner가 작업을 수행하고 있습니다.";
    companionIntakeText = "완료되면 채팅과 서랍에 결과가 반영됩니다.";
  }

  mainAvatarStateEl.textContent = companionStateText;
  mainAvatarStateEl.className = companionStateText
    ? "summary-text"
    : "summary-text empty-state";
  workspaceStatePillEl.textContent = summary.avatar?.mainState ?? "idle";
  workspaceStatePillEl.className = `task-runner-status-pill ${
    latestBlockingTask
      ? "waiting"
      : activeRunnerCount > 0
        ? "running"
        : "completed"
  }`;

  liveRouteSummaryEl.textContent =
    companionRouteText;
  liveRouteSummaryEl.className = companionRouteText
    ? "summary-text"
    : "summary-text empty-state";

  liveRouteDetailEl.textContent = voiceState.routing?.detail ?? "";
  liveRouteDetailEl.className = voiceState.routing?.detail
    ? "summary-detail"
    : "summary-detail empty-state";

  if (summary.intake?.active) {
    voiceIntakeSummaryEl.textContent = companionIntakeText;
    voiceIntakeSummaryEl.className = "summary-text";
  } else {
    voiceIntakeSummaryEl.textContent = companionIntakeText;
    voiceIntakeSummaryEl.className =
      activeRunnerCount > 0 || latestBlockingTask
        ? "summary-detail"
        : "summary-detail empty-state";
  }

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
    case "running":
      return "Running";
    case "waiting_input":
      return "Need Input";
    case "approval_required":
      return "Need Approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
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

function buildTaskRunnerEntries(summary) {
  const timelineByTaskId = buildTaskTimelineMap(summary);
  const activeTasksById = new Map(
    (summary.activeTasks ?? []).map((task) => [task.id, task])
  );

  return (summary.avatar?.taskRunners ?? []).map((runner, index) => {
    const task = activeTasksById.get(runner.taskId);
    const latestEvent = (timelineByTaskId.get(runner.taskId) ?? []).at(-1);

    return {
      ...runner,
      label: runner.label ?? `Task Runner ${index + 1}`,
      title: runner.title ?? task?.title ?? "Untitled task",
      latestUpdate:
        runner.progressSummary ??
        latestEvent?.message ??
        "진행 상황을 기다리는 중입니다.",
      completionSummary: task?.completionReport?.summary ?? null,
      lastUpdatedAt:
        runner.lastUpdatedAt ?? latestEvent?.createdAt ?? task?.updatedAt ?? null
    };
  });
}

function buildDrawerEntries(summary) {
  const timelineByTaskId = buildTaskTimelineMap(summary);
  const activeTaskIds = new Set((summary.activeTasks ?? []).map((task) => task.id));
  const latestNotificationByTaskId = new Map();

  for (const plan of [
    ...(summary.notifications?.delivered ?? []),
    ...(summary.notifications?.pending ?? [])
  ]) {
    if (plan.taskId && !latestNotificationByTaskId.has(plan.taskId)) {
      latestNotificationByTaskId.set(plan.taskId, plan);
    }
  }

  const taskEntries = (summary.recentTasks ?? [])
    .filter((task) => !activeTaskIds.has(task.id))
    .map((task) => {
      const latestEvent = (timelineByTaskId.get(task.id) ?? []).at(-1);
      const relatedNotification = latestNotificationByTaskId.get(task.id);
      const primaryText =
        task.completionReport?.summary ??
        relatedNotification?.uiText ??
        latestEvent?.message ??
        "저장된 결과 요약이 없습니다.";
      const detailLines = uniqueNonEmptyLines([
        relatedNotification?.uiText,
        latestEvent?.message,
        task.completionReport?.changes?.length
          ? `changes · ${task.completionReport.changes.join(", ")}`
          : null,
        task.completionReport?.verification
          ? `verification · ${task.completionReport.verification}`
          : null
      ]).filter((line) => line !== primaryText);

      return {
        kind: "task",
        id: `task:${task.id}`,
        title: task.title,
        subtitle: [
          task.id,
          formatTaskRunnerStatus(task.status),
          task.updatedAt ? formatTime(task.updatedAt) : null
        ]
          .filter(Boolean)
          .join(" · "),
        text: primaryText,
        meta: detailLines.join(" · "),
        updatedAt:
          relatedNotification?.createdAt ??
          latestEvent?.createdAt ??
          task.updatedAt
      };
    });

  const notificationOnlyEntries = [
    ...(summary.notifications?.delivered ?? []),
    ...(summary.notifications?.pending ?? [])
  ]
    .filter((plan) => !plan.taskId || !taskEntries.some((entry) => entry.id === `task:${plan.taskId}`))
    .map((plan, index) => ({
      kind: "briefing",
      id: `briefing:${plan.taskId ?? plan.reason ?? index}`,
      title: plan.taskId ? `Task ${plan.taskId}` : plan.reason ?? "briefing",
      subtitle: [
        plan.reason ?? plan.delivery ?? "briefing",
        typeof plan.createdAt === "string" ? formatTime(plan.createdAt) : null
      ]
        .filter(Boolean)
        .join(" · "),
      text: plan.uiText ?? "표시할 브리핑이 없습니다.",
      meta: plan.delivery ? `delivery · ${plan.delivery}` : "",
      updatedAt: plan.createdAt ?? null
    }));

  return [...taskEntries, ...notificationOnlyEntries].sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    return rightTime - leftTime;
  });
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

  selectedTaskRunnerId = taskRunners[0].taskId;
  return taskRunners[0];
}

function renderTaskRunnerDetail(selectedRunner) {
  if (!selectedRunner) {
    taskRunnerDetailCardEl.hidden = true;
    taskRunnerDetailBlockingEl.hidden = true;
    taskRunnerDetailSummaryEl.hidden = true;
    return;
  }

  taskRunnerDetailCardEl.hidden = false;
  taskRunnerDetailCardEl.dataset.status = selectedRunner.status;
  taskRunnerDetailLabelEl.textContent = selectedRunner.label;
  taskRunnerDetailTitleEl.textContent = selectedRunner.title;
  taskRunnerDetailStatusEl.textContent = formatTaskRunnerStatus(selectedRunner.status);
  taskRunnerDetailStatusEl.className = `task-runner-status-pill ${
    getTaskRunnerAccent(selectedRunner.status)
  }`;
  taskRunnerDetailIdEl.textContent = `taskId · ${selectedRunner.taskId}`;
  taskRunnerDetailUpdateEl.textContent = selectedRunner.latestUpdate;
  taskRunnerDetailUpdatedAtEl.textContent = selectedRunner.lastUpdatedAt
    ? `updated · ${formatTime(selectedRunner.lastUpdatedAt)}`
    : "";

  if (selectedRunner.blockingReason) {
    taskRunnerDetailBlockingEl.hidden = false;
    taskRunnerDetailBlockingEl.textContent = `blocked · ${selectedRunner.blockingReason}`;
  } else {
    taskRunnerDetailBlockingEl.hidden = true;
    taskRunnerDetailBlockingEl.textContent = "";
  }

  if (selectedRunner.completionSummary) {
    taskRunnerDetailSummaryEl.hidden = false;
    taskRunnerDetailSummaryEl.textContent = `summary · ${selectedRunner.completionSummary}`;
  } else {
    taskRunnerDetailSummaryEl.hidden = true;
    taskRunnerDetailSummaryEl.textContent = "";
  }
}

function renderTaskRunnerCards() {
  const summary = getTaskSummary();
  const taskRunners = buildTaskRunnerEntries(summary);
  const selectedRunner = reconcileSelectedTaskRunner(taskRunners);

  taskRunnerListEl.innerHTML = "";

  if (taskRunners.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stack-empty";
    empty.textContent = "활성 task runner가 없습니다.";
    taskRunnerListEl.appendChild(empty);
    renderTaskRunnerDetail(null);
    return;
  }

  for (const runner of taskRunners) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `task-runner-card ${getTaskRunnerAccent(runner.status)}${
      runner.taskId === selectedTaskRunnerId ? " selected" : ""
    }`;
    card.setAttribute("aria-pressed", runner.taskId === selectedTaskRunnerId ? "true" : "false");
    card.innerHTML = `
      <span class="task-runner-avatar" aria-hidden="true">
        <span class="task-runner-avatar-core"></span>
      </span>
      <span class="task-runner-copy">
        <span class="task-runner-label-row">
          <span class="task-runner-label"></span>
          <span class="task-runner-pill"></span>
        </span>
        <span class="task-runner-title"></span>
        <span class="task-runner-update"></span>
      </span>
    `;
    card.querySelector(".task-runner-label").textContent = runner.label;
    const runnerPill = card.querySelector(".task-runner-pill");
    runnerPill.textContent = formatTaskRunnerStatus(runner.status);
    runnerPill.className = `task-runner-pill ${getTaskRunnerAccent(runner.status)}`;
    card.querySelector(".task-runner-title").textContent = runner.title;
    card.querySelector(".task-runner-update").textContent = runner.latestUpdate;
    card.addEventListener("click", () => {
      selectedTaskRunnerId = runner.taskId;
      renderTaskRunnerCards();
    });
    taskRunnerListEl.appendChild(card);
  }

  renderTaskRunnerDetail(selectedRunner);
}

function renderTaskLists(state) {
  const summary = getTaskSummary();
  const drawerEntries = buildDrawerEntries(summary);

  taskDrawerCountEl.textContent = `${drawerEntries.length} items`;
  taskDrawerDescriptionEl.textContent =
    drawerEntries.length > 0
      ? "완료되거나 멈춘 작업의 결과와 최근 브리핑을 여기에서 다시 확인할 수 있습니다."
      : "완료되거나 멈춘 작업은 여기에서 다시 확인할 수 있습니다.";
  taskDrawerDescriptionEl.className =
    drawerEntries.length > 0 ? "summary-detail" : "summary-detail empty-state";

  renderStackList(taskDrawerListEl, drawerEntries, {
    emptyText: "아직 서랍에 들어온 작업이 없습니다.",
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
    empty.textContent = "선택한 조건에 맞는 디버그 이벤트가 없습니다.";
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

function renderUiState(nextState) {
  desktopUiState = nextState;
  const voiceState = getVoiceState();
  const inputState = desktopUiState.inputState ?? {};

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
      ? "Gemini Live에 연결 중입니다…"
      : voiceState.connected
        ? "실시간 대화를 듣고 바로 반응할 준비가 됐습니다."
        : "라이브 대화가 아직 시작되지 않았습니다.";

  liveConnectButtonEl.disabled = voiceState.connected || voiceState.connecting;
  liveMuteButtonEl.disabled = !voiceState.connected;
  liveHangupButtonEl.disabled = !voiceState.connected && !voiceState.connecting;
  liveMuteButtonEl.textContent = voiceState.muted ? "Unmute" : "Mute";

  if (desktopUiState.runtimeError) {
    showRuntimeError(desktopUiState.runtimeError);
  } else {
    hideRuntimeError();
  }

  renderConversationFeed(desktopUiState);
  renderSummaryCardState(desktopUiState);
  renderTaskRunnerCards();
  renderTaskLists(desktopUiState);
  renderDebugInspector(desktopUiState);
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
    await window.desktopLive.connect();
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

bootstrap().catch((error) => {
  console.error(error);
  showRuntimeError(error);
});
