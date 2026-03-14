import { describe, expect, it, vi } from "vitest";
import {
  createInMemorySessionPersistence,
  createPostgresSessionPersistence
} from "../src/index.js";
import type { SqlClientLike } from "../src/index.js";

function createSqlMock(rowsQueue: unknown[][] = []): SqlClientLike {
  return {
    query: vi.fn(
      async () =>
        ({
          rows: rowsQueue.shift() ?? []
        }) as { rows: unknown[] }
    ) as SqlClientLike["query"]
  };
}

describe("session-persistence", () => {
  it("creates in-memory persistence by default", () => {
    const persistence = createInMemorySessionPersistence();

    expect(persistence.brainSessionRepository).toBeTruthy();
    expect(persistence.conversationRepository).toBeTruthy();
    expect(persistence.taskRepository).toBeTruthy();
    expect(persistence.taskEventRepository).toBeTruthy();
    expect(persistence.taskExecutorSessionRepository).toBeTruthy();
  });

  it("creates postgres persistence and ensures brain session when requested", async () => {
    const sql = createSqlMock([[], []]);

    const persistence = await createPostgresSessionPersistence({
      sql,
      ensureBrainSession: {
        brainSessionId: "brain-1",
        userId: "user-1",
        source: "text_dev",
        now: "2026-03-08T00:00:00.000Z"
      }
    });

    expect(persistence.conversationRepository).toBeTruthy();
    expect(persistence.brainSessionRepository).toBeTruthy();
    expect(persistence.taskRepository).toBeTruthy();
    expect(persistence.taskEventRepository).toBeTruthy();
    expect(persistence.taskExecutorSessionRepository).toBeTruthy();
    expect(sql.query).toHaveBeenCalled();
  });
});
