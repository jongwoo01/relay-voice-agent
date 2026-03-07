import type { ExecutorRunRequest } from "@agent/local-executor-protocol";

export interface GeminiCliCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export function buildGeminiCliCommand(
  request: ExecutorRunRequest
): GeminiCliCommand {
  const args = request.resumeSessionId
    ? ["-r", request.resumeSessionId, request.prompt, "--output-format", "stream-json"]
    : [request.prompt, "--output-format", "stream-json"];

  return {
    command: "gemini",
    args,
    cwd: request.workingDirectory
  };
}
