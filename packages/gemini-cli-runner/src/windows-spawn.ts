export interface PlatformSpawnCommandInput {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface PlatformSpawnCommand {
  file: string;
  args: string[];
  windowsHide?: boolean;
}

function isWindowsCommandShim(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

export function resolvePlatformSpawnCommand(
  input: PlatformSpawnCommandInput
): PlatformSpawnCommand {
  const platform = input.platform ?? process.platform;

  if (platform === "win32" && isWindowsCommandShim(input.file)) {
    const shell =
      input.env?.ComSpec?.trim() || process.env.ComSpec?.trim() || "cmd.exe";

    return {
      file: shell,
      args: ["/d", "/s", "/c", input.file, ...input.args],
      windowsHide: true
    };
  }

  return {
    file: input.file,
    args: input.args,
    windowsHide: platform === "win32" ? true : undefined
  };
}
