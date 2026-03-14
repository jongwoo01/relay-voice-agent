import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvFromRoot } from "./src/main/config/env-loader.js";
import { HostedSessionRuntime } from "./src/main/session/hosted-session-runtime.js";
import { CloudSessionClient } from "./src/main/cloud/cloud-session-client.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";
import { DesktopUiStateStore } from "./src/main/ui/desktop-ui-state.js";
import {
  clearDesktopLog,
  logDesktop,
  subscribeDesktopLog
} from "./src/main/debug/desktop-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let runtime;
let cloudSession;
const desktopUiState = new DesktopUiStateStore();

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));
clearDesktopLog();
logDesktop("[desktop-main] boot (cloud-first)");

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

function broadcastUiState() {
  broadcastToWindow("desktop-ui:state-updated", desktopUiState.compose());
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function redactSensitiveText(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  return value
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]")
    .replace(/1\/\/[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]");
}

function buildRawExecutorEventSummary(event) {
  const summary = {
    type: event?.type ?? null
  };

  if (event?.payload && typeof event.payload === "object") {
    const payload = event.payload;
    summary.payloadKeys = Object.keys(payload).slice(0, 12);
    if (typeof payload.status === "string") {
      summary.status = payload.status;
    }
    if (typeof payload.name === "string") {
      summary.name = payload.name;
    } else if (typeof payload.tool_name === "string") {
      summary.name = payload.tool_name;
    }

    const nestedResult =
      payload.result && typeof payload.result === "object" ? payload.result : null;

    const response = firstString([
      payload.response,
      payload.output,
      payload.content,
      typeof payload.result === "string" ? payload.result : null,
      nestedResult?.response,
      nestedResult?.message,
      nestedResult?.text,
      nestedResult?.output,
      nestedResult?.content
    ]);

    if (response) {
      summary.responseSnippet =
        redactSensitiveText(
          response.length > 160 ? `${response.slice(0, 160)}...` : response
        );
    }
  }

  return summary;
}

subscribeDesktopLog((line) => {
  broadcastToWindow("desktop:log", line);
});

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

  runtime = new HostedSessionRuntime({
    onStateChange: async (state) => {
      desktopUiState.setSessionState(state);
      broadcastToWindow("session:state-updated", state);
      broadcastUiState();
    }
  });

  cloudSession = new CloudSessionClient({
    onConversationState: async (state, brainSessionId) => {
      if (brainSessionId) {
        await runtime.setBrainSessionId(brainSessionId);
      }
      desktopUiState.setLiveState(state);
      broadcastToWindow("live:state-updated", state);
      broadcastUiState();
    },
    onTaskState: async (state, brainSessionId) => {
      if (brainSessionId) {
        await runtime.setBrainSessionId(brainSessionId);
      }
      await runtime.applyRemoteTaskState(state);
    },
    onAudioChunk: async (chunk) => {
      broadcastToWindow("live:audio-chunk", chunk);
    },
    onRawExecutorEvent: async (event) => {
      const summary = buildRawExecutorEventSummary(event);
      logDesktop(
        `[desktop-main] raw executor event: ${JSON.stringify(summary)}`
      );
      desktopUiState.appendDebugEvent({
        source: "executor",
        kind: event?.type ?? "executor_event",
        summary: event?.type ?? "executor event",
        detail: JSON.stringify(summary),
        taskId:
          event?.payload && typeof event.payload === "object"
            ? typeof event.payload.taskId === "string"
              ? event.payload.taskId
              : undefined
            : undefined
      });
      broadcastUiState();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    void cloudSession?.disconnect?.().catch(() => undefined);
    mainWindow = undefined;
    runtime = undefined;
    cloudSession = undefined;
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

  ipcMain.handle("session:send", async (event, text) => {
    assertTrustedSender(event);
    await runtime.startInput(text);
    try {
      const state = await cloudSession.sendText(text);
      await runtime.finishInput();
      return state;
    } catch (error) {
      await runtime.setError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  });

  ipcMain.handle("companion:send-typed-turn", async (event, text) => {
    assertTrustedSender(event);
    await runtime.startInput(text);
    try {
      const state = await cloudSession.sendText(text);
      await runtime.finishInput();
      return state;
    } catch (error) {
      await runtime.setError(error instanceof Error ? error.message : String(error));
      throw error;
    }
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
    const state = await cloudSession.getState();
    desktopUiState.setLiveState(state);
    broadcastUiState();
    return state;
  });

  ipcMain.handle("desktop-ui:init", async (event) => {
    assertTrustedSender(event);
    const [sessionState, liveState] = await Promise.all([
      runtime.init(),
      cloudSession.getState()
    ]);
    desktopUiState.setSessionState(sessionState);
    desktopUiState.setLiveState(liveState);
    return desktopUiState.compose();
  });

  ipcMain.handle("live:connect", async (event, passcode) => {
    assertTrustedSender(event);
    return cloudSession.connect(passcode);
  });

  ipcMain.handle("live:disconnect", async (event) => {
    assertTrustedSender(event);
    return cloudSession.disconnect();
  });

  ipcMain.handle("live:set-muted", async (event, muted) => {
    assertTrustedSender(event);
    return cloudSession.setMuted(muted);
  });

  ipcMain.handle("live:end-audio-stream", async (event) => {
    assertTrustedSender(event);
    cloudSession.endAudioStream();
    return cloudSession.getState();
  });

  ipcMain.handle("live:send-text", async (event, text) => {
    assertTrustedSender(event);
    return cloudSession.sendText(text);
  });

  ipcMain.on("live:send-audio-chunk", (event, audioData, mimeType) => {
    assertTrustedSender(event);
    cloudSession.sendAudioChunk(audioData, mimeType);
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
