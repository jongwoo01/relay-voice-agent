import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopSessionRuntime } from "./src/main/session/desktop-session-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let runtime;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f6f2ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  runtime = DesktopSessionRuntime.create({
    executionMode: process.env.DESKTOP_EXECUTOR,
    onStateChange: async (state) => {
      mainWindow.webContents.send("session:state-updated", state);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("session:init", async () => runtime.init());
  ipcMain.handle("session:send", async (_event, text) => {
    return runtime.sendText(text);
  });
  ipcMain.handle("session:toggle-mic", async () => runtime.toggleMic());
  ipcMain.handle("session:set-user-speaking", async (_event, speaking) =>
    runtime.setUserSpeaking(speaking)
  );
  ipcMain.handle("session:set-assistant-speaking", async (_event, speaking) =>
    runtime.setAssistantSpeaking(speaking)
  );

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
