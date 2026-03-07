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
    ? [
        "-r",
        request.resumeSessionId,
        "-p",
        request.prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ]
    : [
        "-p",
        request.prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ];

  return {
    command: "gemini",
    args,
    cwd: request.workingDirectory
  };
}
