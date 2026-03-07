import type {
  ExecutorRunResult,
  LocalExecutor
} from "@agent/local-executor-protocol";
import type { Task } from "@agent/shared-types";

export class MockExecutor implements LocalExecutor {
  async run(request: { task: Task; now: string }): Promise<ExecutorRunResult> {
    return {
      progressEvents: [
        {
          taskId: request.task.id,
          type: "executor_progress",
          message: "브라우저를 확인하는 중",
          createdAt: request.now
        }
      ],
      completionEvent: {
        taskId: request.task.id,
        type: "executor_completed",
        message: "작업을 완료했어요",
        createdAt: request.now
      }
    };
  }
}
