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
