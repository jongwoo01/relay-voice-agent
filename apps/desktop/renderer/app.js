const messagesEl = document.getElementById("messages");
const tasksEl = document.getElementById("tasks");
const composerEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const micStateEl = document.getElementById("mic-state");
const micToggleEl = document.getElementById("mic-toggle");
const runtimeMetaEl = document.getElementById("runtime-meta");
const executorBadgeEl = document.getElementById("executor-badge");
const runtimeErrorEl = document.getElementById("runtime-error");
const inputStatusEl = document.getElementById("input-status");
const userSpeakingStateEl = document.getElementById("user-speaking-state");
const assistantSpeakingStateEl = document.getElementById("assistant-speaking-state");
const notificationsEl = document.getElementById("notifications");
const pendingBriefingsCountEl = document.getElementById(
  "pending-briefings-count"
);
const executorDebugPanelEl = document.getElementById("executor-debug-panel");
const executorDebugLogEl = document.getElementById("executor-debug-log");
const liveStatusBadgeEl = document.getElementById("live-status-badge");
const liveStatusTextEl = document.getElementById("live-status-text");
const liveConnectButtonEl = document.getElementById("live-connect-button");
const liveMuteButtonEl = document.getElementById("live-mute-button");
const liveHangupButtonEl = document.getElementById("live-hangup-button");
const liveMicSelectEl = document.getElementById("live-mic-select");
const liveInputPartialEl = document.getElementById("live-input-partial");
const liveOutputTranscriptEl = document.getElementById("live-output-transcript");
const liveDebugLogEl = document.getElementById("live-debug-log");
const liveMessageListEl = document.getElementById("live-message-list");
const voiceTaskSummaryEl = document.getElementById("voice-task-summary");
const voiceBriefingSummaryEl = document.getElementById("voice-briefing-summary");
const voiceIntakeSummaryEl = document.getElementById("voice-intake-summary");
const mainAvatarStateEl = document.getElementById("main-avatar-state");
const memorySignalListEl = document.getElementById("memory-signal-list");
const subAvatarListEl = document.getElementById("sub-avatar-list");

let sessionState = null;
let liveState = {
  connected: false,
  connecting: false,
  status: "idle",
  muted: false,
  inputPartial: "",
  lastUserTranscript: "",
  outputTranscript: "",
  error: null
};
let liveAudioContext;
let liveRecorderContext;
let liveRecorderSource;
let liveRecorderStream;
let liveRecorderNode;
let liveRecorderFallbackNode;
let liveRecorderGainNode;
let liveAudioQueue = [];
let liveAudioQueueProcessing = false;
let liveAudioNextStartTime = 0;
let liveLastProducedAudioAt = null;
let liveUserSpeakingTimer;
let liveUserSpeakingActive = false;
let liveSpeechCandidateStartAt = 0;
const activeAudioSources = [];
const LIVE_INPUT_BUFFER_SIZE = 512;
const LIVE_SPEECH_ACTIVITY_THRESHOLD = 0.03;
const LIVE_SPEECH_IDLE_MS = 320;
const LIVE_BARGE_IN_CONFIRM_MS = 140;

function formatLatency(fromIso, toIso) {
  if (!fromIso || !toIso) {
    return "n/a";
  }

  const deltaMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return deltaMs >= 0 ? `${deltaMs}ms` : "n/a";
}

function setLiveStatusMessage(message) {
  liveStatusTextEl.textContent = message;
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
  if (sessionState?.activity?.userSpeaking === speaking) {
    return;
  }

  const state = await window.desktopSession.setUserSpeaking(speaking);
  renderState(state);
}

async function setRuntimeAssistantSpeaking(speaking) {
  if (sessionState?.activity?.assistantSpeaking === speaking) {
    return;
  }

  const state = await window.desktopSession.setAssistantSpeaking(speaking);
  renderState(state);
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
      const audioBuffer = liveAudioContext.createBuffer(
        1,
        chunk.length,
        24000
      );
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
    setLiveStatusMessage("이 환경에서는 microphone device 조회를 지원하지 않습니다.");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const existingValue = liveMicSelectEl.value;
  liveMicSelectEl.innerHTML = '<option value="">Default microphone</option>';

  for (const device of inputs) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent =
      device.label || `Microphone ${liveMicSelectEl.length}`;
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
  liveRecorderNode?.disconnect();
  liveRecorderFallbackNode?.disconnect();
  liveRecorderGainNode?.disconnect();
  liveRecorderSource?.disconnect();
  liveRecorderStream?.getTracks().forEach((track) => track.stop());
  liveRecorderNode = undefined;
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
  setLiveStatusMessage("microphone 권한을 요청하는 중...");
  liveRecorderStream = await navigator.mediaDevices.getUserMedia(constraints);
  setLiveStatusMessage("microphone 연결 완료. Gemini Live에 연결 중...");
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

  const bufferSize = LIVE_INPUT_BUFFER_SIZE;
  liveRecorderFallbackNode = liveRecorderContext.createScriptProcessor(
    bufferSize,
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
  setLiveStatusMessage("microphone 연결 완료. script processor recorder active.");
}

function renderLiveState(state) {
  liveState = state;
  const statusLabel = {
    idle: "Idle",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    interrupted: "Interrupted",
    error: "Error",
    connecting: "Connecting"
  }[state.status] ?? state.status;
  liveStatusBadgeEl.textContent = statusLabel;
  liveStatusBadgeEl.className = `executor-badge ${state.connected ? "gemini" : ""}`;
  liveStatusTextEl.textContent = state.error
    ? `voice error: ${state.error}`
    : state.connecting
      ? "Gemini Live에 연결 중입니다..."
      : state.connected
        ? "실시간 대화를 듣고 바로 반응할 준비가 됐습니다."
        : "라이브 대화가 아직 시작되지 않았습니다.";

  liveConnectButtonEl.disabled = state.connected || state.connecting;
  liveMuteButtonEl.disabled = !state.connected;
  liveHangupButtonEl.disabled = !state.connected && !state.connecting;
  liveMuteButtonEl.textContent = state.muted ? "Unmute" : "Mute";

  liveInputPartialEl.textContent =
    state.inputPartial || "지금 말하면 바로 받아적습니다.";
  liveInputPartialEl.className = state.inputPartial
    ? "voice-transcript-text"
    : "voice-transcript-text empty-state";
  liveOutputTranscriptEl.textContent =
    state.outputTranscript || "지금은 응답을 만들고 있지 않습니다.";
  liveOutputTranscriptEl.className = state.outputTranscript
    ? "voice-transcript-text"
    : "voice-transcript-text empty-state";
  const metrics = state.metrics ?? {};
  liveDebugLogEl.textContent = [
    `last local audio chunk: ${liveLastProducedAudioAt ?? "n/a"}`,
    `session open: ${metrics.connectedAt ?? "n/a"}`,
    `local -> input partial: ${formatLatency(liveLastProducedAudioAt, metrics.firstInputPartialAt)}`,
    `local -> input final: ${formatLatency(liveLastProducedAudioAt, metrics.firstInputFinalAt)}`,
    `local -> first assistant transcript: ${formatLatency(liveLastProducedAudioAt, metrics.firstOutputTranscriptAt)}`,
    `local -> first assistant audio: ${formatLatency(liveLastProducedAudioAt, metrics.firstOutputAudioAt)}`,
    "",
    "[Summary Events]",
    ...(metrics.rawEvents ?? [])
  ].join("\n");
  renderVoiceTaskSummary(sessionState);
  renderLiveMessages(state.liveMessages ?? []);
}

function renderLiveMessages(messages) {
  liveMessageListEl.innerHTML = "";

  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 live 대화가 없습니다.";
    liveMessageListEl.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const item = document.createElement("article");
    item.className =
      message.role === "system"
        ? "briefing-card pending"
        : `message ${message.role}${message.partial ? " partial" : ""}${
            message.status === "interrupted" ? " interrupted" : ""
          }`;

    if (message.role === "system") {
      item.innerHTML = `
        <p class="briefing-label">Live Event</p>
        <p class="briefing-text"></p>
      `;
      item.querySelector(".briefing-text").textContent = message.text;
      liveMessageListEl.appendChild(item);
      continue;
    }

    item.innerHTML = `
      <p class="message-role"></p>
      <p class="message-text"></p>
    `;
    item.querySelector(".message-role").textContent = message.partial
      ? `${message.role} (live)`
      : message.status === "interrupted"
        ? `${message.role} (cut short)`
        : message.role;
    item.querySelector(".message-text").textContent = message.text;
    liveMessageListEl.appendChild(item);
  }

  liveMessageListEl.scrollTop = liveMessageListEl.scrollHeight;
}

function renderVoiceTaskSummary(state) {
  const activeTask = state?.tasks?.[0];
  const delivered = state?.notifications?.delivered ?? [];
  const pending = state?.notifications?.pending ?? [];
  const latestBriefing = pending.at(-1) ?? delivered.at(-1);

  voiceTaskSummaryEl.textContent = activeTask
    ? `${activeTask.title} · ${activeTask.status}`
    : "아직 맡겨둔 task가 없습니다.";
  voiceTaskSummaryEl.className = activeTask
    ? "voice-summary-text"
    : "voice-summary-text empty-state";

  voiceBriefingSummaryEl.textContent = latestBriefing
    ? latestBriefing.speechText ?? latestBriefing.uiText
    : "아직 새 briefing이 없습니다.";
  voiceBriefingSummaryEl.className = latestBriefing
    ? "voice-summary-text"
    : "voice-summary-text empty-state";
}

function renderMainAvatarState(state) {
  const label = {
    idle: "Idle",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    briefing: "Briefing",
    waiting_user: "Waiting For You",
    reflecting: "Reflecting"
  }[state?.avatar?.mainState] ?? "Idle";

  mainAvatarStateEl.textContent = label;
  mainAvatarStateEl.className = state?.avatar?.mainState
    ? "voice-summary-text"
    : "voice-summary-text empty-state";
}

function renderTaskIntake(intake) {
  if (!intake?.active) {
    voiceIntakeSummaryEl.textContent = "지금 보충 질문 중인 작업이 없습니다.";
    voiceIntakeSummaryEl.className = "voice-summary-text empty-state";
    return;
  }

  const missing = (intake.missingSlots ?? []).join(", ");
  const question = intake.lastQuestion
    ? ` · ${intake.lastQuestion}`
    : "";
  voiceIntakeSummaryEl.textContent = missing
    ? `waiting for: ${missing}${question}`
    : `ready to run · ${intake.workingText}`;
  voiceIntakeSummaryEl.className = "voice-summary-text";
}

function renderMemorySignals(signals) {
  memorySignalListEl.innerHTML = "";

  if (!signals || signals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 기억 후보가 없습니다.";
    memorySignalListEl.appendChild(empty);
    return;
  }

  for (const signal of signals) {
    const item = document.createElement("article");
    item.className = "signal-card";
    item.innerHTML = `
      <p class="message-role"></p>
      <p class="briefing-text"></p>
      <p class="briefing-delivery"></p>
    `;
    item.querySelector(".message-role").textContent = signal.type;
    item.querySelector(".briefing-text").textContent = signal.summary;
    item.querySelector(".briefing-delivery").textContent = signal.policy;
    memorySignalListEl.appendChild(item);
  }
}

function renderSubAvatars(subAvatars) {
  subAvatarListEl.innerHTML = "";

  if (!subAvatars || subAvatars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 활성 worker가 없습니다.";
    subAvatarListEl.appendChild(empty);
    return;
  }

  for (const avatar of subAvatars) {
    const item = document.createElement("article");
    item.className = "briefing-card delivered";
    item.innerHTML = `
      <p class="briefing-label"></p>
      <p class="briefing-text"></p>
      <p class="briefing-delivery"></p>
    `;
    item.querySelector(".briefing-label").textContent = `${avatar.label} · ${avatar.status}`;
    item.querySelector(".briefing-text").textContent =
      avatar.progressSummary ?? "진행 상황을 기다리는 중입니다.";
    item.querySelector(".briefing-delivery").textContent =
      avatar.blockingReason ?? "running";
    subAvatarListEl.appendChild(item);
  }
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";

  for (const message of messages) {
    const item = document.createElement("article");
    item.className = `message ${message.speaker}`;
    item.innerHTML = `
      <p class="message-role">${message.speaker}</p>
      <p class="message-text"></p>
    `;
    item.querySelector(".message-text").textContent = message.text;
    messagesEl.appendChild(item);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderTasks(tasks, timelines) {
  tasksEl.innerHTML = "";
  const timelineByTaskId = new Map(
    timelines.map((timeline) => [timeline.taskId, timeline.events])
  );

  if (tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "현재 진행 중인 task가 없습니다.";
    tasksEl.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const events = timelineByTaskId.get(task.id) ?? [];
    const latestEvent = events.at(-1);
    const item = document.createElement("article");
    item.className = "task-card";
    item.innerHTML = `
      <p class="task-title"></p>
      <p class="task-status"></p>
      <p class="task-event"></p>
    `;
    item.querySelector(".task-title").textContent = task.title;
    item.querySelector(".task-status").textContent = task.status;
    item.querySelector(".task-event").textContent = latestEvent
      ? `${latestEvent.type}: ${latestEvent.message}`
      : "이벤트 없음";
    tasksEl.appendChild(item);
  }
}

function renderNotifications(notifications) {
  notificationsEl.innerHTML = "";

  if (notifications.delivered.length === 0 && notifications.pending.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 briefing이 없습니다.";
    notificationsEl.appendChild(empty);
    return;
  }

  for (const plan of notifications.delivered) {
    const item = document.createElement("article");
    item.className = "briefing-card delivered";
    item.innerHTML = `
      <p class="briefing-label">Delivered</p>
      <p class="briefing-text"></p>
      <p class="briefing-delivery"></p>
    `;
    item.querySelector(".briefing-text").textContent = plan.speechText ?? plan.uiText;
    item.querySelector(".briefing-delivery").textContent = plan.delivery;
    notificationsEl.appendChild(item);
  }

  for (const plan of notifications.pending) {
    const item = document.createElement("article");
    item.className = "briefing-card pending";
    item.innerHTML = `
      <p class="briefing-label">Pending</p>
      <p class="briefing-text"></p>
      <p class="briefing-delivery"></p>
    `;
    item.querySelector(".briefing-text").textContent = plan.speechText ?? plan.uiText;
    item.querySelector(".briefing-delivery").textContent = plan.delivery;
    notificationsEl.appendChild(item);
  }
}

function renderState(state) {
  sessionState = state;
  hideRuntimeError();
  renderMessages(state.messages);
  renderTasks(state.tasks, state.taskTimelines ?? []);
  renderNotifications(state.notifications);
  renderVoiceTaskSummary(state);
  renderTaskIntake(state.intake);
  renderMainAvatarState(state);
  renderMemorySignals(state.memorySignals ?? []);
  renderSubAvatars(state.avatar?.subAvatars ?? []);
  runtimeMetaEl.textContent = `session=${state.brainSessionId}`;
  executorBadgeEl.textContent = `executor=${state.executionMode}`;
  executorBadgeEl.className = `executor-badge ${state.executionMode}`;
  pendingBriefingsCountEl.textContent = `pending briefing ${state.pendingBriefingCount}`;
  inputStatusEl.textContent = state.input.inFlight
    ? `working: ${state.input.activeText ?? state.input.lastSubmittedText ?? ""}`
    : "idle";
  micStateEl.textContent = state.mic.mode;
  micToggleEl.textContent = state.mic.enabled ? "Mic On" : "Mic Off";
  userSpeakingStateEl.textContent = state.activity.userSpeaking
    ? "User Speaking"
    : "User Idle";
  assistantSpeakingStateEl.textContent = state.activity.assistantSpeaking
    ? "Assistant Speaking"
    : "Assistant Idle";

  if (state.input.lastError) {
    showRuntimeError(state.input.lastError);
  }

  renderDebug(state.debug);
}

function renderDebug(debug) {
  const events = debug?.rawExecutorEvents ?? [];
  if (events.length === 0) {
    executorDebugPanelEl.hidden = true;
    executorDebugLogEl.textContent = "";
    return;
  }

  executorDebugPanelEl.hidden = false;
  executorDebugLogEl.textContent = events
    .map((event) => JSON.stringify(event))
    .join("\n");
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

async function bootstrap() {
  if (!window.desktopSession || typeof window.desktopSession.init !== "function") {
    throw new Error("desktopSession bridge is not available. Check preload setup.");
  }
  if (!window.desktopLive || typeof window.desktopLive.init !== "function") {
    throw new Error("desktopLive bridge is not available. Check preload setup.");
  }

  const [state, initialLiveState] = await Promise.all([
    window.desktopSession.init(),
    window.desktopLive.init()
  ]);
  renderState(state);
  renderLiveState(initialLiveState);

  window.desktopSession.onStateUpdated((nextState) => {
    renderState(nextState);
  });
  window.desktopLive.onStateUpdated((nextState) => {
    renderLiveState(nextState);
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
  const text = promptEl.value.trim();
  if (!text) {
    return;
  }

  try {
    promptEl.value = "";
    inputStatusEl.textContent = `working: ${text}`;
    const result = await window.desktopCompanion.sendTypedTurn(text);
    if (result?.sessionState) {
      renderState(result.sessionState);
    }
    if (result?.liveState) {
      renderLiveState(result.liveState);
    }
  } catch (error) {
    showRuntimeError(error);
  }
});

micToggleEl.addEventListener("click", async () => {
  try {
    const state = await window.desktopSession.toggleMic();
    renderState(state);
  } catch (error) {
    showRuntimeError(error);
  }
});

liveConnectButtonEl.addEventListener("click", async () => {
  try {
    hideRuntimeError();
    stopPlayback();
    liveLastProducedAudioAt = null;
    const state = await window.desktopLive.connect();
    renderLiveState(state);
    await startVoiceCapture();
  } catch (error) {
    showRuntimeError(error);
    await stopVoiceCapture().catch(() => undefined);
    await window.desktopLive.disconnect().catch(() => undefined);
    renderLiveState(await window.desktopLive.init().catch(() => liveState));
  }
});

liveMuteButtonEl.addEventListener("click", async () => {
  try {
    const nextMuted = !liveState.muted;
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
    const state = await window.desktopLive.setMuted(nextMuted);
    renderLiveState(state);
  } catch (error) {
    showRuntimeError(error);
  }
});

liveHangupButtonEl.addEventListener("click", async () => {
  try {
    await stopVoiceCapture();
    stopPlayback();
    await setRuntimeAssistantSpeaking(false);
    const state = await window.desktopLive.disconnect();
    renderLiveState(state);
  } catch (error) {
    showRuntimeError(error);
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composerEl.requestSubmit();
  }
});

bootstrap().catch((error) => {
  console.error(error);
  showRuntimeError(error);
});
