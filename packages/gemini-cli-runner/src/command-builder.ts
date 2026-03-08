import type { ExecutorRunRequest } from "@agent/local-executor-protocol";

export interface GeminiCliCommand {
  command: string;
  args: string[];
  cwd?: string;
}

const COMPLETION_REPORT_INSTRUCTIONS = [
  "You are executing a local desktop task.",
  "Perform the work conservatively and never claim a file change you did not verify yourself.",
  "If you are unsure whether a move/delete/write happened, say it is uncertain instead of claiming success.",
  "Your final answer in the result.response field must be a single-line JSON object with this exact shape:",
  '{"summary":"string","verification":"verified|uncertain","changes":["string"],"question":"string"}',
  'Use "question" only when you need user input or approval; otherwise return an empty string.',
  'Use "changes" for concrete verified actions or observations only. If nothing was verified, return an empty array.',
  "Do not wrap the JSON in markdown fences."
].join("\n");

function buildExecutorPrompt(request: ExecutorRunRequest): string {
  const locationHint = request.workingDirectory
    ? `Working directory: ${request.workingDirectory}`
    : "Working directory: current default workspace";

  return `${COMPLETION_REPORT_INSTRUCTIONS}\n\n${locationHint}\n\nUser task:\n${request.prompt}`;
}

export function buildGeminiCliCommand(
  request: ExecutorRunRequest
): GeminiCliCommand {
  const prompt = buildExecutorPrompt(request);
  const args = request.resumeSessionId
    ? [
        "-r",
        request.resumeSessionId,
        "-p",
        prompt,
        "--approval-mode",
        "yolo",
        "--output-format",
        "stream-json"
      ]
    : [
        "-p",
        prompt,
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
