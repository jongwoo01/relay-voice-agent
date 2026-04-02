const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopSession", {
  init: () => ipcRenderer.invoke("session:init"),
  send: (text) => ipcRenderer.invoke("session:send", text),
  toggleMic: () => ipcRenderer.invoke("session:toggle-mic"),
  setUserSpeaking: (speaking) =>
    ipcRenderer.invoke("session:set-user-speaking", speaking),
  setAssistantSpeaking: (speaking) =>
    ipcRenderer.invoke("session:set-assistant-speaking", speaking),
  onStateUpdated: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("session:state-updated", wrapped);

    return () => {
      ipcRenderer.removeListener("session:state-updated", wrapped);
    };
  }
});

contextBridge.exposeInMainWorld("desktopCompanion", {
  sendTypedTurn: (text) => ipcRenderer.invoke("companion:send-typed-turn", text)
});

contextBridge.exposeInMainWorld("relayApp", {
  sendTypedTurn: (text) => ipcRenderer.invoke("relay:send-typed-turn", text)
});

contextBridge.exposeInMainWorld("desktopUi", {
  init: () => ipcRenderer.invoke("desktop-ui:init"),
  getSettings: () => ipcRenderer.invoke("desktop-ui:get-settings"),
  getSetupStatus: (options) => ipcRenderer.invoke("desktop-ui:get-setup-status", options),
  updateSettings: (patch) => ipcRenderer.invoke("desktop-ui:update-settings", patch),
  resetSettings: () => ipcRenderer.invoke("desktop-ui:reset-settings"),
  copyText: (text) => ipcRenderer.invoke("desktop-ui:copy-text", text),
  cancelTask: (taskId) => ipcRenderer.invoke("desktop-ui:cancel-task", taskId),
  copyDiagnosticsSnapshot: () => ipcRenderer.invoke("desktop-ui:copy-diagnostics"),
  refreshHistory: () => ipcRenderer.invoke("desktop-ui:refresh-history"),
  retryExecutorHealthCheck: () =>
    ipcRenderer.invoke("desktop-ui:retry-executor-health"),
  disableGeminiFolderTrust: () =>
    ipcRenderer.invoke("desktop-ui:disable-gemini-folder-trust"),
  trustGeminiWorkspace: () =>
    ipcRenderer.invoke("desktop-ui:trust-gemini-workspace"),
  openSupportTarget: (target) => ipcRenderer.invoke("desktop-ui:open-support-target", target),
  openGeminiLoginTerminal: () =>
    ipcRenderer.invoke("desktop-ui:open-gemini-login-terminal"),
  onStateUpdated: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("desktop-ui:state-updated", wrapped);

    return () => {
      ipcRenderer.removeListener("desktop-ui:state-updated", wrapped);
    };
  }
});

contextBridge.exposeInMainWorld("desktopDebug", {
  onLog: (listener) => {
    const wrapped = (_event, line) => listener(line);
    ipcRenderer.on("desktop:log", wrapped);

    return () => {
      ipcRenderer.removeListener("desktop:log", wrapped);
    };
  }
});

contextBridge.exposeInMainWorld("desktopSystem", {
  platform: process.platform,
  getMicrophoneAccessStatus: () =>
    ipcRenderer.invoke("system:get-microphone-access-status"),
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke("system:request-microphone-access"),
  openMicrophonePrivacySettings: () =>
    ipcRenderer.invoke("system:open-microphone-privacy-settings"),
  openMacPrivacySettings: (section) =>
    ipcRenderer.invoke("system:open-mac-privacy-settings", section)
});

contextBridge.exposeInMainWorld("desktopLive", {
  init: () => ipcRenderer.invoke("live:init"),
  connect: (passcode) => ipcRenderer.invoke("live:connect", passcode),
  disconnect: () => ipcRenderer.invoke("live:disconnect"),
  setMuted: (muted) => ipcRenderer.invoke("live:set-muted", muted),
  startActivity: () => ipcRenderer.send("live:activity-start"),
  endActivity: () => ipcRenderer.send("live:activity-end"),
  endAudioStream: () => ipcRenderer.invoke("live:end-audio-stream"),
  sendText: (text) => ipcRenderer.invoke("live:send-text", text),
  sendAudioChunk: (audioData, mimeType) =>
    ipcRenderer.send("live:send-audio-chunk", audioData, mimeType),
  onStateUpdated: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("live:state-updated", wrapped);

    return () => {
      ipcRenderer.removeListener("live:state-updated", wrapped);
    };
  },
  onAudioChunk: (listener) => {
    const wrapped = (_event, chunk) => listener(chunk);
    ipcRenderer.on("live:audio-chunk", wrapped);

    return () => {
      ipcRenderer.removeListener("live:audio-chunk", wrapped);
    };
  }
});
