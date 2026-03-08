import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDotEnvFromRoot } from "@agent/agent-api";
import { DesktopSessionRuntime } from "./src/main/session/desktop-session-runtime.js";
import { assertTrustedSenderUrl } from "./src/main/ipc/sender-guard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let runtime;

loadDotEnvFromRoot(path.resolve(__dirname, "..", ".."));

const rendererEntry = path.join(__dirname, "renderer", "index.html");
const rendererEntryUrl = pathToFileURL(rendererEntry).toString();

function assertTrustedSender(event) {
  const senderFrame = event.senderFrame;
  const senderUrl = senderFrame?.url;
  assertTrustedSenderUrl(senderUrl, rendererEntryUrl);
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
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send("session:state-updated", state);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
    runtime = undefined;
  });

  mainWindow.loadFile(rendererEntry);
}

app.whenReady().then(() => {
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
