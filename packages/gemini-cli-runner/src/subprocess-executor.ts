import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ExecutorRunRequest,
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import { buildGeminiCliCommand } from "./command-builder.js";
import { parseGeminiCliOutput } from "./output-parser.js";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<ExecResult>;

export async function defaultExecFile(
  file: string,
  args: string[],
  options?: { cwd?: string }
): Promise<ExecResult> {
  const result = await execFileAsync(file, args, options);

  return {
    stdout: typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8"),
    stderr: typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf8")
  };
}

export class GeminiCliExecutor implements LocalExecutor {
  constructor(private readonly exec: ExecFileLike = defaultExecFile) {}

  async run(request: ExecutorRunRequest): Promise<ExecutorRunResult> {
    const command = buildGeminiCliCommand(request);
    const result = await this.exec(command.command, command.args, {
      cwd: command.cwd
    });
    const parsed = parseGeminiCliOutput(result.stdout);

    return {
      progressEvents: [],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: parsed.message,
        createdAt: request.now
      },
      sessionId: parsed.sessionId
    };
  }
}
