import { existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MICROPHONE_USAGE_DESCRIPTION =
  "Relay needs microphone access to capture your voice and open a live session.";

function setPlistString(plistPath, key, value) {
  const plistBuddy = "/usr/libexec/PlistBuddy";
  const printCommand = `Print :${key}`;
  const setCommand = `Set :${key} ${value}`;
  const addCommand = `Add :${key} string ${value}`;

  try {
    execFileSync(plistBuddy, ["-c", printCommand, plistPath], {
      stdio: "ignore"
    });
    execFileSync(plistBuddy, ["-c", setCommand, plistPath], {
      stdio: "ignore"
    });
  } catch {
    execFileSync(plistBuddy, ["-c", addCommand, plistPath], {
      stdio: "ignore"
    });
  }
}

export default async function patchMacMicrophonePlists(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appContentsPath = path.join(context.appOutDir, `${appName}.app`, "Contents");
  const candidatePlists = [
    path.join(appContentsPath, "Info.plist"),
    path.join(appContentsPath, "Frameworks", `${appName} Helper.app`, "Contents", "Info.plist"),
    path.join(
      appContentsPath,
      "Frameworks",
      `${appName} Helper (Renderer).app`,
      "Contents",
      "Info.plist"
    ),
    path.join(
      appContentsPath,
      "Frameworks",
      `${appName} Helper (GPU).app`,
      "Contents",
      "Info.plist"
    ),
    path.join(
      appContentsPath,
      "Frameworks",
      `${appName} Helper (Plugin).app`,
      "Contents",
      "Info.plist"
    )
  ];

  for (const plistPath of candidatePlists) {
    if (!existsSync(plistPath)) {
      continue;
    }

    setPlistString(plistPath, "NSMicrophoneUsageDescription", MICROPHONE_USAGE_DESCRIPTION);
  }

  console.log(
    `[relay][afterPack] ensured NSMicrophoneUsageDescription across packaged app plists`
  );
}
