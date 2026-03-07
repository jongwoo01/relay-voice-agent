import type { BrainTurnInput, NextAction, Task, TaskEvent, TaskExecutorSession } from "@agent/shared-types";
import { ConversationOrchestrator } from "./conversation-orchestrator.js";
import { TaskExecutionService } from "../tasks/task-execution-service.js";

export interface BrainTurnResult {
  action: NextAction;
  replyText?: string;
  task?: Task;
  taskEvents?: TaskEvent[];
  executorSession?: TaskExecutorSession;
}

export type TaskIdGenerator = () => string;

function defaultTaskIdGenerator(): string {
  return `task-${crypto.randomUUID()}`;
}

export class BrainTurnService {
  constructor(
    private readonly orchestrator: ConversationOrchestrator = new ConversationOrchestrator(),
    private readonly taskExecutionService: TaskExecutionService = new TaskExecutionService(),
    private readonly createTaskId: TaskIdGenerator = defaultTaskIdGenerator
  ) {}

  async handle(input: BrainTurnInput): Promise<BrainTurnResult> {
    const action = this.orchestrator.decide(input.utterance, input.activeTasks);

    if (action.type === "reply") {
      return {
        action,
        replyText: "메인 대화 레이어에서 바로 응답하면 됩니다."
      };
    }

    if (action.type === "clarify") {
      return {
        action,
        replyText: "조금 더 구체적으로 말해줘."
      };
    }

    const taskId = action.type === "resume_task" ? action.taskId : this.createTaskId();
    const existingTask =
      action.type === "resume_task"
        ? input.activeTasks.find((task) => task.id === action.taskId)
        : undefined;

    const taskResult = await this.taskExecutionService.dispatch({
      brainSessionId: input.brainSessionId,
      taskId,
      text: input.utterance.text,
      now: input.now,
      existingTask
    });

    return {
      action,
      task: taskResult.task,
      taskEvents: taskResult.events,
      executorSession: taskResult.executorSession
    };
  }
}
