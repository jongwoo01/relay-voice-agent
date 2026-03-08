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

  const state = await window.desktopSession.init();
  renderState(state);

  window.desktopSession.onStateUpdated((nextState) => {
    renderState(nextState);
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
