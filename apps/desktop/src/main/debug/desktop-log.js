import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DESKTOP_LOG_PATH = path.join(
  os.tmpdir(),
  "gemini-live-agent-desktop.log"
);

const logListeners = new Set();

export function clearDesktopLog() {
  try {
    fs.writeFileSync(DESKTOP_LOG_PATH, "");
  } catch {
    // Ignore logging setup failures.
  }
}

export function subscribeDesktopLog(listener) {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

export function logDesktop(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);

  try {
    fs.appendFileSync(DESKTOP_LOG_PATH, `${line}\n`);
  } catch {
    // Ignore file logging failures.
  }

  for (const listener of logListeners) {
    try {
      listener(line);
    } catch {
      // Ignore listener failures.
    }
  }

  return line;
}
