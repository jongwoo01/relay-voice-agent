export interface PromptMetadata {
  id: string;
  purpose: string;
  usedBy: string;
  pipeline: string;
  inputContract: string;
  outputContract: string;
}

export interface PromptSpec<TInput> {
  metadata: PromptMetadata;
  build(input: TInput): string;
}

export interface ExecutorPromptInput {
  prompt: string;
  workingDirectory?: string;
  platform?: NodeJS.Platform;
  windowsShellMode?: "avoid" | "allow";
}

export const EXECUTOR_COMPLETION_REPORT_PROMPT_ID =
  "relay.executor.local_desktop_task";

/**
 * Local Gemini CLI execution prompt.
 * Pipeline: TaskRuntime -> Connected desktop executor -> Gemini CLI headless run.
 * Input: normalized working directory hint plus the user task prompt.
 * Output: free-form final answer followed by a REPORT_JSON line parsed by output-parser.ts.
 */
export const EXECUTOR_COMPLETION_REPORT_PROMPT: PromptSpec<ExecutorPromptInput> = {
  metadata: {
    id: EXECUTOR_COMPLETION_REPORT_PROMPT_ID,
    purpose:
      "Instruct Gemini CLI to execute local desktop work conservatively and emit REPORT_JSON for structured result parsing.",
    usedBy: "buildGeminiCliCommand",
    pipeline: "local desktop task execution",
    inputContract:
      "Requires the task prompt and an optional normalized working directory hint.",
    outputContract:
      "Natural-language answer, then a REPORT_JSON line matching output-parser.ts expectations."
  },
  build(input) {
    const { prompt, workingDirectory, platform } = input;
    const locationHint = workingDirectory
      ? `Working directory: ${workingDirectory}`
      : "Working directory: current default workspace";
    const windowsExecutionGuidance =
      platform === "win32" ? inputWindowsExecutionGuidance(input) : [];

    return [
      "You are executing a local desktop task.",
      "Perform the work conservatively and never claim a file change you did not verify yourself.",
      "If you are unsure whether a move/delete/write happened, say it is uncertain instead of claiming success.",
      "Prefer built-in directory and file tools over shell commands for inspection, counting, or listing tasks.",
      "If the user asks to read, quote, print, or transcribe a local text file, return the requested file contents directly unless the file is binary, unreadable, or the user explicitly asked for only a summary.",
      "Do not replace a direct file-content request with a summary, paraphrase, or invented privacy-policy refusal unless a tool result actually shows that limitation.",
      "For directory inspection requests, default to the immediate children of the named directory.",
      "Do not recurse into subdirectories, use ls -R, find, or other deep scans unless the user explicitly asked for recursive, nested, deep, or descendant results.",
      "Do not expand a simple listing request into a broader filesystem crawl just to be extra thorough.",
      "In the final result.response field, first write the complete natural-language answer for the user.",
      'After that, add a new line that starts with REPORT_JSON: followed by a single-line JSON object with this shape:',
      '{"summary":"string","keyFindings":["string"],"verification":"verified|uncertain","changes":["string"],"question":"string"}',
      'Keep "summary" short and useful for a card preview or spoken completion briefing, but do not omit the main requested facts when they fit in one sentence.',
      'If the user asked for exact names, IDs, paths, or other concrete items, include those facts in the natural-language answer and in "keyFindings".',
      'Use "keyFindings" for the important concrete facts that should be reusable in a follow-up answer.',
      'Use "question" only when you need user input or approval; otherwise return an empty string.',
      'Use "changes" for concrete verified actions or observations only. If nothing was verified, return an empty array.',
      "Do not wrap the JSON in markdown fences.",
      ...windowsExecutionGuidance,
      "",
      locationHint,
      "",
      "User task:",
      prompt
    ].join("\n");
  }
};

export function buildExecutorPrompt(input: ExecutorPromptInput): string {
  return EXECUTOR_COMPLETION_REPORT_PROMPT.build(input);
}

function inputWindowsExecutionGuidance(input: ExecutorPromptInput): string[] {
  if (input.platform !== "win32") {
    return [];
  }

  if (input.windowsShellMode === "allow") {
    return [
      "You are running on Windows.",
      "The user request likely needs command execution such as tests, builds, installs, git, server startup, migrations, or other CLI work.",
      "Use built-in file and directory tools first for inspection, then use shell commands only for the execution steps that truly require them.",
      "When shell usage is necessary, keep commands simple and compatible with cmd.exe, avoid fragile quoting, and prefer the smallest command that verifies the requested outcome."
    ];
  }

  return [
    "You are running on Windows.",
    "This task should stay on built-in file and directory tools unless shell commands are absolutely required to complete the user's request.",
    "Prefer built-in file and directory tools for listing, reading, writing, renaming, or moving files, especially when paths may contain spaces.",
    "Do not use shell commands just because they are convenient when built-in tools can complete the task.",
    "If shell usage becomes truly unavoidable, keep commands simple and compatible with cmd.exe, and avoid fragile quoting."
  ];
}
