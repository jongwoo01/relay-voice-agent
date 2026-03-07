const messagesEl = document.getElementById("messages");
const tasksEl = document.getElementById("tasks");
const composerEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const micStateEl = document.getElementById("mic-state");
const micToggleEl = document.getElementById("mic-toggle");
const userSpeakingToggleEl = document.getElementById("user-speaking-toggle");
const assistantSpeakingToggleEl = document.getElementById(
  "assistant-speaking-toggle"
);
const notificationsEl = document.getElementById("notifications");

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

function renderTasks(tasks) {
  tasksEl.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "현재 진행 중인 task가 없습니다.";
    tasksEl.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("article");
    item.className = "task-card";
    item.innerHTML = `
      <p class="task-title"></p>
      <p class="task-status"></p>
    `;
    item.querySelector(".task-title").textContent = task.title;
    item.querySelector(".task-status").textContent = task.status;
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
  renderMessages(state.messages);
  renderTasks(state.tasks);
  renderNotifications(state.notifications);
  micStateEl.textContent = state.mic.mode;
  micToggleEl.textContent = state.mic.enabled ? "Mic On" : "Mic Off";
  userSpeakingToggleEl.textContent = state.activity.userSpeaking
    ? "User Speaking"
    : "User Idle";
  assistantSpeakingToggleEl.textContent = state.activity.assistantSpeaking
    ? "Assistant Speaking"
    : "Assistant Idle";
}

async function bootstrap() {
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

  promptEl.value = "";
  const state = await window.desktopSession.send(text);
  renderState(state);
});

micToggleEl.addEventListener("click", async () => {
  const state = await window.desktopSession.toggleMic();
  renderState(state);
});

userSpeakingToggleEl.addEventListener("click", async () => {
  const next = userSpeakingToggleEl.textContent !== "User Speaking";
  const state = await window.desktopSession.setUserSpeaking(next);
  renderState(state);
});

assistantSpeakingToggleEl.addEventListener("click", async () => {
  const next = assistantSpeakingToggleEl.textContent !== "Assistant Speaking";
  const state = await window.desktopSession.setAssistantSpeaking(next);
  renderState(state);
});

bootstrap().catch((error) => {
  console.error(error);
});
