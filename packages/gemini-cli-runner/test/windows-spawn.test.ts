import { describe, expect, it } from "vitest";
import { resolvePlatformSpawnCommand } from "../src/windows-spawn.js";

describe("resolvePlatformSpawnCommand", () => {
  it("routes Windows .cmd shims through cmd.exe", () => {
    const result = resolvePlatformSpawnCommand({
      file: "C:\\Users\\user\\AppData\\Roaming\\npm\\gemini.cmd",
      args: ["--version"],
      env: {
        ComSpec: "C:\\Windows\\System32\\cmd.exe"
      },
      platform: "win32"
    });

    expect(result).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "C:\\Users\\user\\AppData\\Roaming\\npm\\gemini.cmd",
        "--version"
      ],
      windowsHide: true
    });
  });

  it("leaves non-Windows commands untouched", () => {
    const result = resolvePlatformSpawnCommand({
      file: "/usr/local/bin/gemini",
      args: ["--version"],
      platform: "darwin"
    });

    expect(result).toEqual({
      file: "/usr/local/bin/gemini",
      args: ["--version"],
      windowsHide: undefined
    });
  });
});
