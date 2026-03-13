import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDefaultGenAiClientFactory,
  loadDotEnvFromRoot,
} from "@agent/agent-api";
import { DesktopSessionRuntime } from "./src/main/session/desktop-session-runtime.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";
import { LiveVoiceSession } from "./src/main/live/live-voice-session.js";
import { createLiveBrainBridge } from "./src/main/integration/live-brain-bridge.js";
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
let liveVoiceSession;
let liveBrainBridge;
const desktopUiState = new DesktopUiStateStore();

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));
clearDesktopLog();
logDesktop("[desktop-main] boot");
try {
  const runtimeMetadata = createDefaultGenAiClientFactory().getRuntimeMetadata();
  logDesktop(
    `[desktop-main] genai runtime ${JSON.stringify(runtimeMetadata)}`
  );
} catch (error) {
  logDesktop(
    `[desktop-main] genai runtime config error ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

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

function summarizeRawExecutorEvent(event) {
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
        response.length > 240 ? `${response.slice(0, 240)}...` : response;
    }

    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.output === "string"
          ? payload.output
          : null;
    if (message) {
      summary.messageSnippet =
        message.length > 240 ? `${message.slice(0, 240)}...` : message;
    }

    if (
      event?.type === "result" &&
      !summary.responseSnippet &&
      !summary.messageSnippet
    ) {
      const preview = JSON.stringify(payload);
      summary.payloadPreview =
        preview.length > 400 ? `${preview.slice(0, 400)}...` : preview;
    }
  }

  return JSON.stringify(summary);
}

function serializeErrorForLog(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause instanceof Error
          ? {
              name: error.cause.name,
              message: error.cause.message,
              stack: error.cause.stack
            }
          : error.cause ?? null
    };
  }

  if (error && typeof error === "object") {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch {
      return { message: String(error) };
    }
  }

  return { message: String(error) };
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
    onRawExecutorEvent: async (event) => {
      logDesktop(
        `[desktop-main] raw executor event: ${summarizeRawExecutorEvent(event)}`
      );
      desktopUiState.appendDebugEvent({
        source: "executor",
        kind: event?.type ?? "executor_event",
        summary: event?.type ?? "executor event",
        detail: summarizeRawExecutorEvent(event)
      });
      broadcastUiState();
    },
    onDebugEvent: async (event) => {
      desktopUiState.appendDebugEvent(event);
      broadcastUiState();
    },
    onStateChange: async (state) => {
      desktopUiState.setSessionState(state);
      await liveBrainBridge?.syncRuntimeContextFromState?.(state);
      broadcastToWindow("session:state-updated", state);
      broadcastUiState();
    }
  });
  liveVoiceSession = new LiveVoiceSession({
    onDebugEvent: async (event) => {
      desktopUiState.appendDebugEvent(event);
      broadcastUiState();
    },
    onStateChange: async (state) => {
      desktopUiState.setLiveState(state);
      broadcastToWindow("live:state-updated", state);
      broadcastUiState();
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
    },
    onToolCall: async (functionCalls) => {
      logDesktop(
        `[desktop-main] live tool call: ${functionCalls
          .map((call) => call.name ?? "unknown")
          .join(", ")}`
      );
      return liveBrainBridge.handleToolCalls(functionCalls);
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
    const state = await runtime.init();
    desktopUiState.setSessionState(state);
    broadcastUiState();
    return state;
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
    const state = await liveVoiceSession.getState();
    desktopUiState.setLiveState(state);
    broadcastUiState();
    return state;
  });
  ipcMain.handle("desktop-ui:init", async (event) => {
    assertTrustedSender(event);
    const [sessionState, liveState] = await Promise.all([
      runtime.init(),
      liveVoiceSession.getState()
    ]);
    desktopUiState.setSessionState(sessionState);
    desktopUiState.setLiveState(liveState);
    return desktopUiState.compose();
  });
  ipcMain.handle("live:connect", async (event) => {
    assertTrustedSender(event);
    logDesktop("[desktop-main] live:connect");
    try {
      return await liveVoiceSession.connect();
    } catch (error) {
      logDesktop(
        `[desktop-main] live:connect failed ${JSON.stringify(
          serializeErrorForLog(error)
        )}`
      );
      throw error;
    }
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
