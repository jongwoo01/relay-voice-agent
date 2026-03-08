import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvFromRoot } from "@agent/agent-api";
import { DesktopSessionRuntime } from "./src/main/session/desktop-session-runtime.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";
import { LiveVoiceSession } from "./src/main/live/live-voice-session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let runtime;
let liveVoiceSession;

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));

const rendererEntry = path.join(__dirname, "renderer", "index.html");
const rendererEntryUrl = pathToFileURL(rendererEntry).toString();

function assertTrustedSender(event) {
  const senderFrame = event.senderFrame;
  const senderUrl = senderFrame?.url;
  assertTrustedSenderUrl(senderUrl, rendererEntryUrl);
}

function broadcastToWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f6f2ea",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  runtime = DesktopSessionRuntime.create({
    executionMode: process.env.DESKTOP_EXECUTOR,
    onStateChange: async (state) => {
      broadcastToWindow("session:state-updated", state);
    }
  });
  liveVoiceSession = new LiveVoiceSession({
    onStateChange: async (state) => {
      broadcastToWindow("live:state-updated", state);
    },
    onAudioChunk: async (event) => {
      broadcastToWindow("live:audio-chunk", event);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    void liveVoiceSession?.disconnect?.().catch(() => undefined);
    mainWindow = undefined;
    runtime = undefined;
    liveVoiceSession = undefined;
  });

  mainWindow.loadFile(rendererEntry);
}

app.whenReady().then(() => {
  const allowedPermissions = new Set(["media", "microphone"]);
  app.on("web-contents-created", (_event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(
        allowedPermissions.has(permission) &&
          webContents.getURL() === rendererEntryUrl
      );
    });
  });

  ipcMain.handle("session:init", async (event) => {
    assertTrustedSender(event);
    return runtime.init();
  });
  ipcMain.handle("session:send", async (_event, text) => {
    assertTrustedSender(_event);
    return runtime.sendText(text);
  });
  ipcMain.handle("session:toggle-mic", async (event) => {
    assertTrustedSender(event);
    return runtime.toggleMic();
  });
  ipcMain.handle("session:set-user-speaking", async (event, speaking) => {
    assertTrustedSender(event);
    return runtime.setUserSpeaking(speaking);
  });
  ipcMain.handle("session:set-assistant-speaking", async (event, speaking) => {
    assertTrustedSender(event);
    return runtime.setAssistantSpeaking(speaking);
  });
  ipcMain.handle("live:init", async (event) => {
    assertTrustedSender(event);
    return liveVoiceSession.getState();
  });
  ipcMain.handle("live:connect", async (event) => {
    assertTrustedSender(event);
    return liveVoiceSession.connect();
  });
  ipcMain.handle("live:disconnect", async (event) => {
    assertTrustedSender(event);
    return liveVoiceSession.disconnect();
  });
  ipcMain.handle("live:set-muted", async (event, muted) => {
    assertTrustedSender(event);
    return liveVoiceSession.setMuted(muted);
  });
  ipcMain.handle("live:send-text", async (event, text) => {
    assertTrustedSender(event);
    liveVoiceSession.sendText(text);
    return liveVoiceSession.getState();
  });
  ipcMain.on("live:send-audio-chunk", (event, audioData, mimeType) => {
    assertTrustedSender(event);
    liveVoiceSession.sendAudioChunk(audioData, mimeType);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
