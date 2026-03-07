export interface ParsedGeminiCliOutput {
  message: string;
  sessionId?: string;
}

function firstNonEmptyString(values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

export function parseGeminiCliOutput(stdout: string): ParsedGeminiCliOutput {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("Gemini CLI output was empty");
  }

  const parsed = JSON.parse(trimmed) as Record<string, unknown>;

  const message = firstNonEmptyString([
    typeof parsed.text === "string" ? parsed.text : undefined,
    typeof parsed.message === "string" ? parsed.message : undefined,
    typeof parsed.output === "string" ? parsed.output : undefined
  ]);

  if (!message) {
    throw new Error("Gemini CLI output did not include a message field");
  }

  const sessionId = firstNonEmptyString([
    typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
    typeof parsed.session_id === "string" ? parsed.session_id : undefined
  ]);

  return {
    message,
    sessionId
  };
}
