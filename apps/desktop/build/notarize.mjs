import { access } from "node:fs/promises";
import path from "node:path";
import { notarize } from "@electron/notarize";

const DEFAULT_KEYCHAIN_PROFILE = "relay-notary";

async function ensureExists(targetPath) {
  await access(targetPath);
  return targetPath;
}

export default async function notarizeRelay(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.SKIP_NOTARIZE === "true") {
    console.log("[relay][notarize] skipping because SKIP_NOTARIZE=true");
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = await ensureExists(path.join(appOutDir, `${appName}.app`));
  const keychainProfile =
    process.env.NOTARYTOOL_KEYCHAIN_PROFILE?.trim() || DEFAULT_KEYCHAIN_PROFILE;

  console.log(
    `[relay][notarize] submitting ${appPath} with keychain profile ${keychainProfile}`
  );

  await notarize({
    appPath,
    keychainProfile
  });

  console.log(`[relay][notarize] notarization completed for ${appPath}`);
}
