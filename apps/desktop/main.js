import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  shell,
  systemPreferences
} from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvFromRoot } from "./src/main/config/env-loader.js";
import { HostedSessionRuntime } from "./src/main/session/hosted-session-runtime.js";
import { CloudSessionClient } from "./src/main/cloud/cloud-session-client.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";
import { DesktopUiStateStore } from "./src/main/ui/desktop-ui-state.js";
import {
  createDefaultSystemStatus,
  normalizeMicrophonePermissionStatus
} from "./src/main/ui/desktop-settings.js";
import { DesktopSettingsStore } from "./src/main/ui/desktop-settings-store.js";
import {
  clearDesktopLog,
  logDesktop,
  subscribeDesktopLog
} from "./src/main/debug/desktop-log.js";
import {
  collectSetupStatus,
  createEmptySetupStatus,
  getSupportTargetDirectory,
  getSupportTargetPath
} from "./src/main/setup/setup-status.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const relayIconPath = path.join(__dirname, "build", "icon.png");

let mainWindow;
let runtime;
let cloudSession;
let settingsStore;
const desktopUiState = new DesktopUiStateStore();
let historyRefreshTimer = null;
let setupStatusCache = createEmptySetupStatus();
let microphoneAccessRequestPromise = null;

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));
clearDesktopLog();
logDesktop("[desktop-main] boot (cloud-first)");

const rendererEntry = path.join(__dirname, "renderer", "dist", "index.html");
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

async function applyDesktopSettings(settings) {
  desktopUiState.setSettings(settings);
  await cloudSession?.setLocalSettings?.(settings);
  broadcastUiState();
  return settings;
}

function getMicrophonePermissionStatus() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return "unknown";
  }

  return normalizeMicrophonePermissionStatus(
    systemPreferences.getMediaAccessStatus("microphone")
  );
}

async function refreshSystemStatus() {
  const nextState = {
    ...createDefaultSystemStatus(),
    microphonePermissionStatus: getMicrophonePermissionStatus()
  };
  desktopUiState.setSystemState(nextState);
  broadcastUiState();
  return nextState;
}

function buildDiagnosticsSnapshot() {
  const uiState = desktopUiState.compose();
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      brainSessionId: uiState.brainSessionId,
      executionMode: uiState.executionMode,
      runtimeError: uiState.runtimeError,
      settings: uiState.settings,
      systemStatus: uiState.systemStatus,
      executorHealth: uiState.executorHealth,
      setupStatus: setupStatusCache,
      historySummary: {
        loading: uiState.historySummary.loading,
        error: uiState.historySummary.error,
        sessionCount: uiState.historySummary.sessions.length
      },
      taskSummary: {
        activeTaskCount: uiState.taskSummary.activeTasks.length,
        recentTaskCount: uiState.taskSummary.recentTasks.length,
        pendingBriefingCount: uiState.taskSummary.pendingBriefingCount
      },
      recentDebugEvents: uiState.debugInspector.events.slice(-25)
    },
    null,
    2
  );
}

async function refreshSetupStatusNow(options = {}) {
  const shouldRefresh = options.refresh === true;
  if (shouldRefresh) {
    await refreshSystemStatus();
    if (cloudSession) {
      await cloudSession.runExecutorHealthCheck("full");
    }
  }

  if (!cloudSession) {
    setupStatusCache = createEmptySetupStatus();
    return setupStatusCache;
  }

  const setupContext = cloudSession.getSetupContext();
  const executorHealth = await cloudSession.getExecutorHealth();
  setupStatusCache = await collectSetupStatus({
    baseUrl: setupContext.baseUrl,
    sessionToken: setupContext.sessionToken,
    executorHealth,
    microphonePermissionStatus: getMicrophonePermissionStatus(),
    lastExecutorWorkingDirectory: setupContext.lastExecutorWorkingDirectory,
    desktopPath: app.getPath("desktop"),
    documentsPath: app.getPath("documents"),
    downloadsPath: app.getPath("downloads")
  });
  return setupStatusCache;
}

function openSystemPrivacyShortcut(section = "files") {
  if (section === "microphone") {
    if (process.platform === "darwin") {
      return shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
      );
    }

    if (process.platform === "win32") {
      return shell.openExternal("ms-settings:privacy-microphone");
    }

    return false;
  }

  if (process.platform !== "darwin") {
    return false;
  }

  return shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  );
}

async function openSupportTarget(target) {
  const urlTargets = {
    gemini_install_docs: "https://github.com/google-gemini/gemini-cli",
    gemini_auth_docs:
      "https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html",
    gemini_config_docs:
      "https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html",
    gemini_trusted_docs:
      "https://google-gemini.github.io/gemini-cli/docs/cli/trusted-folders.html"
  };

  if (urlTargets[target]) {
    await shell.openExternal(urlTargets[target]);
    return true;
  }

  const targetPath = getSupportTargetPath(target);
  if (!targetPath) {
    return false;
  }

  const result = await shell.openPath(targetPath);
  if (!result) {
    return true;
  }

  const directory = getSupportTargetDirectory(targetPath);
  if (!directory) {
    return false;
  }

  const fallback = await shell.openPath(directory);
  return !fallback;
}

async function openTerminalForGeminiLogin() {
  if (process.platform === "darwin") {
    await new Promise((resolve, reject) => {
      const command = 'tell application "Terminal" to do script "gemini"\ntell application "Terminal" to activate';
      const child = spawn("osascript", ["-e", command], {
        stdio: "ignore"
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`osascript exited with ${code}`));
      });
    });
    return true;
  }

  return false;
}

async function refreshHistoryNow() {
  if (!cloudSession) {
    return;
  }

  try {
    const state = await cloudSession.refreshHistory();
    desktopUiState.setHistoryState(state);
    broadcastUiState();
  } catch (error) {
    logDesktopError("history refresh failed", {
      error: serializeUnknownError(error)
    });
  }
}

function scheduleHistoryRefresh() {
  if (historyRefreshTimer) {
    clearTimeout(historyRefreshTimer);
  }

  historyRefreshTimer = setTimeout(() => {
    historyRefreshTimer = null;
    void refreshHistoryNow();
  }, 450);
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

function serializeUnknownError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null
    };
  }

  return {
    name: typeof error,
    message: String(error),
    stack: null
  };
}

function logDesktopError(label, details) {
  const serialized = JSON.stringify(details);
  console.error(`[desktop-main] ${label} ${serialized}`);
  logDesktop(`[desktop-main] ${label} ${serialized}`);
}

function registerIpcHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      logDesktopError("ipc handler failed", {
        channel,
        error: serializeUnknownError(error)
      });
      throw error;
    }
  });
}

async function requestSystemMicrophoneAccess() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return true;
  }

  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") {
    return true;
  }

  if (status === "restricted") {
    return false;
  }

  if (microphoneAccessRequestPromise) {
    return microphoneAccessRequestPromise;
  }

  microphoneAccessRequestPromise = (async () => {
    if (process.platform === "darwin") {
      return systemPreferences.askForMediaAccess("microphone");
    }

    return false;
  })();

  try {
    return await microphoneAccessRequestPromise;
  } finally {
    microphoneAccessRequestPromise = null;
  }
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
    },
    icon: relayIconPath
  });

  mainWindow.webContents.on("console-message", (details) => {
    logDesktop(
      `[desktop-renderer][console:${details.level}] ${JSON.stringify({
        message: redactSensitiveText(details.message),
        line: details.lineNumber,
        sourceId: details.sourceId
      })}`
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logDesktopError("renderer process gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  runtime = new HostedSessionRuntime({
    onStateChange: async (state) => {
      desktopUiState.setSessionState(state);
      broadcastToWindow("session:state-updated", state);
      broadcastUiState();
    }
  });

  cloudSession = new CloudSessionClient({
    localSettings: settingsStore?.get?.(),
    onConversationState: async (state, brainSessionId) => {
      const runtimeInstance = runtime;

      if (brainSessionId && runtimeInstance) {
        await runtimeInstance.setBrainSessionId(brainSessionId);
      }
      desktopUiState.setLiveState(state);
      broadcastToWindow("live:state-updated", state);
      broadcastUiState();
    },
    onTaskState: async (state, brainSessionId) => {
      const runtimeInstance = runtime;

      if (brainSessionId && runtimeInstance) {
        await runtimeInstance.setBrainSessionId(brainSessionId);
      }

      if (runtimeInstance) {
        await runtimeInstance.applyRemoteTaskState(state);
      }
      scheduleHistoryRefresh();
    },
    onHistoryState: async (state) => {
      desktopUiState.setHistoryState(state);
      broadcastUiState();
    },
    onAudioChunk: async (chunk) => {
      broadcastToWindow("live:audio-chunk", chunk);
    },
    onDebugEvent: async (event) => {
      desktopUiState.appendDebugEvent(event);
      broadcastUiState();
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
    },
    onExecutorHealth: async (health, executionMode) => {
      const runtimeInstance = runtime;
      if (runtimeInstance) {
        await runtimeInstance.setExecutionContext({
          executionMode,
          executorHealth: health
        });
      }
    }
  });

  if (settingsStore) {
    desktopUiState.setSettings(settingsStore.get());
  }
  desktopUiState.setSystemState({
    ...createDefaultSystemStatus(),
    microphonePermissionStatus: getMicrophonePermissionStatus()
  });

  void cloudSession.getExecutorHealth().then((health) =>
    runtime?.setExecutionContext({
      executionMode: cloudSession.execution.mode,
      executorHealth: health
    })
  );
  void cloudSession.runExecutorHealthCheck("binary");

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

app.whenReady().then(async () => {
  settingsStore = new DesktopSettingsStore({
    directory: app.getPath("userData")
  });
  try {
    await settingsStore.load();
  } catch (error) {
    logDesktopError("settings load failed", {
      error: serializeUnknownError(error)
    });
  }
  desktopUiState.setSettings(settingsStore.get());
  await refreshSystemStatus();

  app.setName("Relay");
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(relayIconPath);
  }

  process.on("uncaughtException", (error) => {
    logDesktopError("uncaught exception", {
      error: serializeUnknownError(error)
    });
  });

  process.on("unhandledRejection", (reason) => {
    logDesktopError("unhandled rejection", {
      error: serializeUnknownError(reason)
    });
  });

  const allowedPermissions = new Set(["media", "microphone"]);
  app.on("web-contents-created", (_event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(
        allowedPermissions.has(permission) &&
          webContents.getURL() === rendererEntryUrl
      );
    });
  });

  registerIpcHandle("session:init", async (event) => {
    assertTrustedSender(event);
    return runtime.init();
  });

  registerIpcHandle("session:send", async (event, text) => {
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

  registerIpcHandle("relay:send-typed-turn", async (event, text) => {
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

  registerIpcHandle("companion:send-typed-turn", async (event, text) => {
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

  registerIpcHandle("session:toggle-mic", async (event) => {
    assertTrustedSender(event);
    return runtime.toggleMic();
  });

  registerIpcHandle("session:set-user-speaking", async (event, speaking) => {
    assertTrustedSender(event);
    return runtime.setUserSpeaking(speaking);
  });

  registerIpcHandle("session:set-assistant-speaking", async (event, speaking) => {
    assertTrustedSender(event);
    return runtime.setAssistantSpeaking(speaking);
  });

  registerIpcHandle("system:request-microphone-access", async (event) => {
    assertTrustedSender(event);
    const granted = await requestSystemMicrophoneAccess();
    await refreshSystemStatus();
    return granted;
  });

  registerIpcHandle("system:get-microphone-access-status", async (event) => {
    assertTrustedSender(event);
    const state = await refreshSystemStatus();
    return state.microphonePermissionStatus;
  });

  registerIpcHandle("live:init", async (event) => {
    assertTrustedSender(event);
    const state = await cloudSession.getState();
    desktopUiState.setLiveState(state);
    broadcastUiState();
    return state;
  });

  registerIpcHandle("desktop-ui:init", async (event) => {
    assertTrustedSender(event);
    await refreshSystemStatus();
    const [sessionState, liveState, historyState] = await Promise.all([
      runtime.init(),
      cloudSession.getState(),
      cloudSession.getHistoryState()
    ]);
    desktopUiState.setSessionState(sessionState);
    desktopUiState.setLiveState(liveState);
    desktopUiState.setHistoryState(historyState);
    return desktopUiState.compose();
  });

  registerIpcHandle("desktop-ui:get-settings", async (event) => {
    assertTrustedSender(event);
    return settingsStore?.get?.() ?? null;
  });

  registerIpcHandle("desktop-ui:get-setup-status", async (event, options) => {
    assertTrustedSender(event);
    return refreshSetupStatusNow(options);
  });

  registerIpcHandle("desktop-ui:update-settings", async (event, patch) => {
    assertTrustedSender(event);
    const nextSettings = await settingsStore.update(patch);
    await applyDesktopSettings(nextSettings);
    return nextSettings;
  });

  registerIpcHandle("desktop-ui:reset-settings", async (event) => {
    assertTrustedSender(event);
    const nextSettings = await settingsStore.reset();
    await applyDesktopSettings(nextSettings);
    return nextSettings;
  });

  registerIpcHandle("desktop-ui:copy-diagnostics", async (event) => {
    assertTrustedSender(event);
    const snapshot = buildDiagnosticsSnapshot();
    clipboard.writeText(snapshot);
    return snapshot;
  });

  registerIpcHandle("desktop-ui:copy-text", async (event, text) => {
    assertTrustedSender(event);
    const value = typeof text === "string" ? text : String(text ?? "");
    clipboard.writeText(value);
    return value;
  });

  registerIpcHandle("desktop-ui:cancel-task", async (event, taskId) => {
    assertTrustedSender(event);
    return cloudSession.cancelTask(taskId);
  });

  registerIpcHandle("desktop-ui:retry-executor-health", async (event) => {
    assertTrustedSender(event);
    return cloudSession.runExecutorHealthCheck("full");
  });

  registerIpcHandle("desktop-ui:refresh-history", async (event) => {
    assertTrustedSender(event);
    await refreshHistoryNow();
    return desktopUiState.compose();
  });

  registerIpcHandle("desktop-ui:open-support-target", async (event, target) => {
    assertTrustedSender(event);
    return openSupportTarget(target);
  });

  registerIpcHandle("desktop-ui:open-gemini-login-terminal", async (event) => {
    assertTrustedSender(event);
    return openTerminalForGeminiLogin();
  });

  registerIpcHandle("system:open-microphone-privacy-settings", async (event) => {
    assertTrustedSender(event);
    await openSystemPrivacyShortcut("microphone");
    return process.platform === "darwin" || process.platform === "win32";
  });

  registerIpcHandle("system:open-mac-privacy-settings", async (event, section) => {
    assertTrustedSender(event);
    await openSystemPrivacyShortcut(section);
    return process.platform === "darwin";
  });

  registerIpcHandle("live:connect", async (event, passcode) => {
    assertTrustedSender(event);
    return cloudSession.connect(passcode);
  });

  registerIpcHandle("live:disconnect", async (event) => {
    assertTrustedSender(event);
    return cloudSession.disconnect();
  });

  registerIpcHandle("live:set-muted", async (event, muted) => {
    assertTrustedSender(event);
    return cloudSession.setMuted(muted);
  });

  ipcMain.on("live:activity-start", (event) => {
    assertTrustedSender(event);
    cloudSession.startActivity();
  });

  ipcMain.on("live:activity-end", (event) => {
    assertTrustedSender(event);
    cloudSession.endActivity();
  });

  registerIpcHandle("live:end-audio-stream", async (event) => {
    assertTrustedSender(event);
    cloudSession.endAudioStream();
    return cloudSession.getState();
  });

  registerIpcHandle("live:send-text", async (event, text) => {
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
