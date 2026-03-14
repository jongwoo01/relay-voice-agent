import type { BrainSessionRepository } from "../persistence/brain-session-repository.js";
import { PostgresBrainSessionRepository } from "../persistence/brain-session-repository.js";
import type { ConversationMessageRepository } from "../persistence/conversation-message-repository.js";
import { PostgresConversationMessageRepository } from "../persistence/conversation-message-repository.js";
import type { SqlClientLike } from "../persistence/postgres-client.js";
import type { TaskRepository } from "../persistence/task-repository.js";
import { PostgresTaskRepository } from "../persistence/task-repository.js";

export interface JudgeHistorySessionSummary {
  brainSessionId: string;
  status: "active" | "closed";
  source: "live" | "text_dev" | "desktop";
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    summary?: string;
  }>;
}

export interface JudgeHistorySnapshot {
  sessions: JudgeHistorySessionSummary[];
}

export class JudgeHistoryService {
  constructor(
    private readonly brainSessionRepository: Pick<
      BrainSessionRepository,
      "listRecentByUserId"
    >,
    private readonly conversationRepository: Pick<
      ConversationMessageRepository,
      "listByBrainSessionId"
    >,
    private readonly taskRepository: Pick<TaskRepository, "listRecentByBrainSessionId">
  ) {}

  async readByUserId(
    userId: string,
    limit?: number
  ): Promise<JudgeHistorySnapshot> {
    const sessions = await this.brainSessionRepository.listRecentByUserId(
      userId,
      limit
    );

    const summaries = await Promise.all(
      sessions.map(async (session) => {
        const [messages, tasks] = await Promise.all([
          this.conversationRepository.listByBrainSessionId(session.id),
          this.taskRepository.listRecentByBrainSessionId(session.id, 3)
        ]);

        const lastUserMessage = [...messages]
          .reverse()
          .find((message) => message.speaker === "user")?.text;
        const lastAssistantMessage = [...messages]
          .reverse()
          .find((message) => message.speaker === "assistant")?.text;

        return {
          brainSessionId: session.id,
          status: session.status,
          source: session.source,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          closedAt: session.closedAt ?? null,
          lastUserMessage,
          lastAssistantMessage,
          recentTasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            updatedAt: task.updatedAt,
            summary: task.completionReport?.summary
          }))
        } satisfies JudgeHistorySessionSummary;
      })
    );

    return {
      sessions: summaries
    };
  }
}

export function createJudgeHistoryService(input: {
  sql: SqlClientLike;
}): JudgeHistoryService {
  return new JudgeHistoryService(
    new PostgresBrainSessionRepository(input.sql),
    new PostgresConversationMessageRepository(input.sql),
    new PostgresTaskRepository(input.sql)
  );
}
