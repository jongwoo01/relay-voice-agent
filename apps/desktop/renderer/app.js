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
const userSpeakingToggleEl = document.getElementById("user-speaking-toggle");
const assistantSpeakingToggleEl = document.getElementById(
  "assistant-speaking-toggle"
);
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
const liveInputFinalEl = document.getElementById("live-input-final");
const liveOutputTranscriptEl = document.getElementById("live-output-transcript");
const liveDebugLogEl = document.getElementById("live-debug-log");
const liveMessageListEl = document.getElementById("live-message-list");

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
const activeAudioSources = [];
const LIVE_INPUT_BUFFER_SIZE = 512;

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
    await window.desktopSession.setAssistantSpeaking(true);

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

    await window.desktopSession.setAssistantSpeaking(false);
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
  await window.desktopSession.setUserSpeaking(false);
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
  liveStatusBadgeEl.textContent = `voice: ${state.status}`;
  liveStatusBadgeEl.className = `executor-badge ${state.connected ? "gemini" : ""}`;
  liveStatusTextEl.textContent = state.error
    ? `voice error: ${state.error}`
    : state.connecting
      ? "connecting to Gemini Live..."
      : state.connected
        ? "live voice preview is active"
        : "voice preview is idle";

  liveConnectButtonEl.disabled = state.connected || state.connecting;
  liveMuteButtonEl.disabled = !state.connected;
  liveHangupButtonEl.disabled = !state.connected && !state.connecting;
  liveMuteButtonEl.textContent = state.muted ? "Unmute" : "Mute";

  liveInputPartialEl.textContent =
    state.inputPartial || "실시간 입력 대기 중입니다.";
  liveInputPartialEl.className = state.inputPartial
    ? "voice-transcript-text"
    : "voice-transcript-text empty-state";
  liveInputFinalEl.textContent = state.lastUserTranscript;
  liveOutputTranscriptEl.textContent =
    state.outputTranscript || "아직 응답이 없습니다.";
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
        : `message ${message.role}`;

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
      ? `${message.role} (typing)`
      : message.role;
    item.querySelector(".message-text").textContent = message.text;
    liveMessageListEl.appendChild(item);
  }

  liveMessageListEl.scrollTop = liveMessageListEl.scrollHeight;
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
  hideRuntimeError();
  renderMessages(state.messages);
  renderTasks(state.tasks, state.taskTimelines ?? []);
  renderNotifications(state.notifications);
  runtimeMetaEl.textContent = `session=${state.brainSessionId}`;
  executorBadgeEl.textContent = `executor=${state.executionMode}`;
  executorBadgeEl.className = `executor-badge ${state.executionMode}`;
  pendingBriefingsCountEl.textContent = `pending briefing ${state.pendingBriefingCount}`;
  inputStatusEl.textContent = state.input.inFlight
    ? `working: ${state.input.activeText ?? state.input.lastSubmittedText ?? ""}`
    : "idle";
  micStateEl.textContent = state.mic.mode;
  micToggleEl.textContent = state.mic.enabled ? "Mic On" : "Mic Off";
  userSpeakingToggleEl.textContent = state.activity.userSpeaking
    ? "User Speaking"
    : "User Idle";
  assistantSpeakingToggleEl.textContent = state.activity.assistantSpeaking
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
    window.desktopSession.send(text).then(renderState).catch(showRuntimeError);
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

userSpeakingToggleEl.addEventListener("click", async () => {
  const next = userSpeakingToggleEl.textContent !== "User Speaking";
  try {
    const state = await window.desktopSession.setUserSpeaking(next);
    renderState(state);
  } catch (error) {
    showRuntimeError(error);
  }
});

assistantSpeakingToggleEl.addEventListener("click", async () => {
  const next = assistantSpeakingToggleEl.textContent !== "Assistant Speaking";
  try {
    const state = await window.desktopSession.setAssistantSpeaking(next);
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
      await window.desktopSession.setUserSpeaking(!nextMuted);
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
