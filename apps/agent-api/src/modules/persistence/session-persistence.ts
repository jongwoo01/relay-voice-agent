import {
  InMemoryBrainSessionRepository,
  type BrainSessionRepository,
  PostgresBrainSessionRepository
} from "./brain-session-repository.js";
import {
  InMemoryConversationMessageRepository,
  type ConversationMessageRepository
} from "./conversation-message-repository.js";
import {
  InMemoryTaskEventRepository,
  type TaskEventRepository
} from "./task-event-repository.js";
import {
  InMemoryTaskExecutorSessionRepository,
  type TaskExecutorSessionRepository
} from "./task-executor-session-repository.js";
import {
  InMemoryTaskRepository,
  type TaskRepository
} from "./task-repository.js";
import {
  InMemoryTaskIntakeRepository,
  PostgresTaskIntakeRepository,
  type TaskIntakeRepository
} from "./task-intake-repository.js";
import { PostgresConversationMessageRepository } from "./conversation-message-repository.js";
import { createPostgresPool, type SqlClientLike } from "./postgres-client.js";
import { PostgresTaskEventRepository } from "./task-event-repository.js";
import { PostgresTaskExecutorSessionRepository } from "./task-executor-session-repository.js";
import { PostgresTaskRepository } from "./task-repository.js";

export interface SessionPersistence {
  brainSessionRepository: BrainSessionRepository;
  taskRepository: TaskRepository;
  taskIntakeRepository: TaskIntakeRepository;
  taskEventRepository: TaskEventRepository;
  taskExecutorSessionRepository: TaskExecutorSessionRepository;
  conversationRepository: ConversationMessageRepository;
}

export function createInMemorySessionPersistence(input?: {
  ensureBrainSession?: {
    brainSessionId: string;
    userId: string;
    source: "live" | "text_dev" | "desktop";
    now: string;
  };
}): SessionPersistence {
  const brainSessionRepository = new InMemoryBrainSessionRepository();
  if (input?.ensureBrainSession) {
    void brainSessionRepository.create({
      id: input.ensureBrainSession.brainSessionId,
      userId: input.ensureBrainSession.userId,
      status: "active",
      source: input.ensureBrainSession.source,
      createdAt: input.ensureBrainSession.now,
      updatedAt: input.ensureBrainSession.now,
      closedAt: null
    });
  }

  return {
    brainSessionRepository,
    conversationRepository: new InMemoryConversationMessageRepository(),
    taskRepository: new InMemoryTaskRepository(),
    taskIntakeRepository: new InMemoryTaskIntakeRepository(),
    taskEventRepository: new InMemoryTaskEventRepository(),
    taskExecutorSessionRepository: new InMemoryTaskExecutorSessionRepository()
  };
}

export async function createPostgresSessionPersistence(input: {
  sql?: SqlClientLike;
  ensureBrainSession?: {
    brainSessionId: string;
    userId: string;
    source: "live" | "text_dev" | "desktop";
    now: string;
  };
}): Promise<SessionPersistence> {
  const sql = input.sql ?? createPostgresPool();

  if (input.ensureBrainSession) {
    const sessions = new PostgresBrainSessionRepository(sql);
    const existing = await sessions.getById(input.ensureBrainSession.brainSessionId);

    if (!existing) {
      await sessions.create({
        id: input.ensureBrainSession.brainSessionId,
        userId: input.ensureBrainSession.userId,
        status: "active",
        source: input.ensureBrainSession.source,
        createdAt: input.ensureBrainSession.now,
        updatedAt: input.ensureBrainSession.now,
        closedAt: null
      });
    }
  }

  return {
    brainSessionRepository: new PostgresBrainSessionRepository(sql),
    conversationRepository: new PostgresConversationMessageRepository(sql),
    taskRepository: new PostgresTaskRepository(sql),
    taskIntakeRepository: new PostgresTaskIntakeRepository(sql),
    taskEventRepository: new PostgresTaskEventRepository(sql),
    taskExecutorSessionRepository: new PostgresTaskExecutorSessionRepository(sql)
  };
}
