import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvFromRoot } from "@agent/agent-api";
import { DesktopSessionRuntime } from "./src/main/session/desktop-session-runtime.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";
import { LiveVoiceSession } from "./src/main/live/live-voice-session.js";
import { createLiveBrainBridge } from "./src/main/integration/live-brain-bridge.js";
import {
  clearDesktopLog,
  logDesktop,
  subscribeDesktopLog
} from "./src/main/debug/desktop-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let runtime;
let liveVoiceSession;
let liveBrainBridge;

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));
clearDesktopLog();
logDesktop("[desktop-main] boot");

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

subscribeDesktopLog((line) => {
  broadcastToWindow("desktop:log", line);
});

function createWindow() {
  logDesktop("[desktop-main] createWindow");
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
    },
    onUserTranscriptFinal: async (text, context) => {
      logDesktop(
        `[desktop-main] live final transcript: ${text}${
          context?.routingHintText ? ` | hint=${context.routingHintText}` : ""
        }`
      );
      return liveBrainBridge.handleFinalTranscript(text, context);
    }
  });
  liveBrainBridge = createLiveBrainBridge({ runtime, liveVoiceSession });

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
    liveBrainBridge = undefined;
  });

  mainWindow.loadFile(rendererEntry);
}

app.whenReady().then(() => {
  logDesktop("[desktop-main] app.whenReady");
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
    logDesktop("[desktop-main] session:init");
    return runtime.init();
  });
  ipcMain.handle("session:send", async (_event, text) => {
    assertTrustedSender(_event);
    logDesktop(`[desktop-main] session:send ${text}`);
    return runtime.sendText(text);
  });
  ipcMain.handle("companion:send-typed-turn", async (event, text) => {
    assertTrustedSender(event);
    logDesktop(`[desktop-main] companion:send-typed-turn ${text}`);
    return liveBrainBridge.sendTypedTurn(text);
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
    logDesktop("[desktop-main] live:init");
    return liveVoiceSession.getState();
  });
  ipcMain.handle("live:connect", async (event) => {
    assertTrustedSender(event);
    logDesktop("[desktop-main] live:connect");
    return liveVoiceSession.connect();
  });
  ipcMain.handle("live:disconnect", async (event) => {
    assertTrustedSender(event);
    logDesktop("[desktop-main] live:disconnect");
    return liveVoiceSession.disconnect();
  });
  ipcMain.handle("live:set-muted", async (event, muted) => {
    assertTrustedSender(event);
    return liveVoiceSession.setMuted(muted);
  });
  ipcMain.handle("live:end-audio-stream", async (event) => {
    assertTrustedSender(event);
    liveVoiceSession.endAudioStream();
    return liveVoiceSession.getState();
  });
  ipcMain.handle("live:send-text", async (event, text) => {
    assertTrustedSender(event);
    return liveVoiceSession.sendText(text);
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
