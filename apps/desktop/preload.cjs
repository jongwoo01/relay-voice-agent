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

contextBridge.exposeInMainWorld("desktopUi", {
  init: () => ipcRenderer.invoke("desktop-ui:init"),
  refreshHistory: () => ipcRenderer.invoke("desktop-ui:refresh-history"),
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
